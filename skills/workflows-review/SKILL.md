---
name: workflows-review
description: Perform exhaustive code reviews using parallel multi-agent analysis. Launches specialized review agents (security, performance, architecture, code quality, patterns) on a PR or branch, synthesizes findings by severity, and produces an actionable review summary. Use when reviewing PRs or branches.
argument-hint: "[PR number, GitHub URL, branch name, or 'latest']"
---

# Multi-Agent Code Review

Perform exhaustive code reviews by delegating to specialized review agents in parallel, then synthesizing findings into a prioritized summary.

## Input

The argument can be:
- **PR number**: `123`
- **GitHub URL**: `https://github.com/org/repo/pull/123`
- **Branch name**: `feat/my-feature`
- **"latest"**: review the most recent PR
- **Empty**: review current branch against default branch

## CRITICAL: cwd must be the target repo

Run `pwd` before calling the subagent tool. Sub-agents must run in the repo being reviewed.

---

## Workflow

### Step 1: Determine Review Target & Fetch PR Info

```bash
# If PR number or URL:
gh pr view <PR> --json title,body,files,number,headRefName,baseRefName,additions,deletions

# If branch name:
git log --oneline origin/main..origin/<branch>
git diff --stat origin/main..origin/<branch>

# If empty (current branch):
current_branch=$(git branch --show-current)
git diff --stat origin/main..$current_branch
```

Extract:
- PR title and description
- List of changed files
- Diff stats (files changed, additions, deletions)
- The actual diff for review context

```bash
# Get the diff content for the review agents
gh pr diff <PR> 2>/dev/null || git diff origin/main..HEAD
```

### Step 2: Checkout the Branch

Make sure you are on the branch being reviewed:

```bash
# For PR:
gh pr checkout <PR>

# For branch:
git checkout <branch>
```

### Step 3: Launch Review Agents (PARALLEL)

Use the `subagent` tool to run review agents in parallel. Include the PR diff and context in each task:

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "kieran-typescript-reviewer",
      task: "Review this PR for TypeScript conventions, type safety, and maintainability.\n\nPR: <title>\nFiles changed: <file list>\nDiff:\n<diff content>"
    },
    {
      agent: "security-sentinel",
      task: "Security audit of this PR. Check for vulnerabilities, input validation, auth/authz issues, hardcoded secrets, OWASP compliance.\n\nPR: <title>\nFiles changed: <file list>\nDiff:\n<diff content>"
    },
    {
      agent: "architecture-strategist",
      task: "Analyze architectural decisions, pattern compliance, design integrity.\n\nPR: <title>\nFiles changed: <file list>\nDiff:\n<diff content>"
    },
    {
      agent: "pattern-recognition-specialist",
      task: "Check for design patterns, anti-patterns, naming conventions, duplication.\n\nPR: <title>\nFiles changed: <file list>\nDiff:\n<diff content>"
    },
    {
      agent: "code-simplicity-reviewer",
      task: "Final pass for simplicity and minimalism. Identify YAGNI violations, over-engineering, unnecessary abstractions.\n\nPR: <title>\nFiles changed: <file list>\nDiff:\n<diff content>"
    }
  ]
})
```

**Select agents based on the PR content:**

| PR contains... | Also include... |
|---|---|
| Database migrations | `data-integrity-guardian`, `data-migration-expert` |
| Deployment/infra changes | `deployment-verification-agent` |
| Frontend JS/Stimulus code | `julik-frontend-races-reviewer` |
| Ruby/Rails code | `kieran-rails-reviewer`, `dhh-rails-reviewer` |
| Python code | `kieran-python-reviewer` |
| Agent tools or MCP | `agent-native-reviewer` |

### Step 4: Simplification Pass

After the parallel review, run a focused simplification review:

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "code-simplicity-reviewer",
      task: "Review the full changeset for opportunities to simplify. Look for code that could be removed, abstractions that aren't needed yet, and overly clever solutions.\n\nFiles: <changed files>\nDiff:\n<diff>"
    }
  ]
})
```

### Step 5: Synthesize Findings

Consolidate all agent reports:

1. **Categorize** by type: security, performance, architecture, quality, style
2. **Assign severity:**
   - **P1 CRITICAL** — blocks merge (security vulnerabilities, data corruption risks, breaking changes)
   - **P2 IMPORTANT** — should fix (performance issues, architectural concerns, reliability)
   - **P3 NICE-TO-HAVE** — enhancements (minor improvements, cleanup, docs)
3. **Remove duplicates** — multiple agents may flag the same issue
4. **Discard false positives** — ignore findings about `docs/plans/` or `docs/solutions/` files

### Step 6: Present Summary

Format the review as:

```markdown
## Code Review Complete

**PR:** #<number> - <title>
**Branch:** <branch-name>
**Files changed:** <count> (+<additions> -<deletions>)

### Findings Summary

- **Total:** <count>
- **P1 CRITICAL:** <count> — BLOCKS MERGE
- **P2 IMPORTANT:** <count> — Should Fix
- **P3 NICE-TO-HAVE:** <count> — Enhancements

### P1 — Critical (Blocks Merge)

1. **[Security]** <description>
   - File: `path/to/file.ts:line`
   - Agent: security-sentinel
   - Fix: <suggested fix>

### P2 — Important

1. **[Performance]** <description>
   - File: `path/to/file.ts:line`
   - Agent: performance-oracle
   - Fix: <suggested fix>

### P3 — Nice-to-Have

1. **[Style]** <description>

### Review Agents Used

<list of agents that ran>

### Verdict

- **APPROVE** — no P1 findings, P2s are minor
- **REQUEST CHANGES** — P1 findings must be addressed before merge
- **COMMENT** — no blockers but important improvements suggested
```

---

## Key Principles

- **Always run agents in parallel** — speed matters for reviews
- **Pass the actual diff** — agents need code context, not just file names
- **Prioritize ruthlessly** — P1 blocks merge, P2 should fix, P3 is optional
- **Remove duplicates** — multiple agents will catch the same issues
- **Be actionable** — every finding needs a file path, line number, and suggested fix

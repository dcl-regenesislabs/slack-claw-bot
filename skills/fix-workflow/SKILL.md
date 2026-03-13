---
name: fix
description: End-to-end workflow for fixing GitHub issues. Accepts a GitHub issue URL or description, creates a branch, plans the fix, implements it, runs tests, and creates a PR. Use when the user says "fix <issue-url>" or "fix <description>".
---

# Fix Issue Workflow (Autonomous)

Autonomous end-to-end workflow for fixing GitHub issues: fetch the issue, find/clone the repo, create a branch, run plan and work workflows, and create the PR.

## When to use

- User says `fix` followed by a GitHub issue URL (e.g., `fix https://github.com/decentraland/creator-hub/issues/123`)
- User says `fix this issue` with a URL or a text description
- User says `fix` followed by a description of the problem

## IMPORTANT: Creator Hub Monorepo

**Creator Hub (`decentraland/creator-hub`) is a MONOREPO.**

**ALL asset pack issues MUST be fixed in the creator-hub repository**, not in individual asset pack repos.

The following repositories are **ARCHIVED** and should NEVER be used:
- `decentraland/asset-packs`

**If an issue is in any archived asset pack repository:**
1. If the issue is on the `decentraland/asset-packs` it must be fixed on the `decentraland/creator-hub`
2. There's no need to duplicate or create the issue again, if it's an asset-packs issue, fix it on the creator hub repo, there's a asset-packs package

## Input parsing

The skill receives one argument:

1. **GitHub issue URL** — Extract issue details using `gh`
2. **Free-text description** — Use directly as context

If no argument is provided, ask: "Which issue should I fix? Please provide a description or the issue URL"

---

## Autonomous Workflow

### Step 1: Parse input and fetch issue details

**If input is a GitHub issue URL:**

```bash
gh issue view <URL> --json title,body,labels,number,repository
```

Extract:
- `title` — Issue title
- `body` — Full description
- `number` — Issue number
- `repository` — Full repo name (e.g., `decentraland/creator-hub`)
- `labels` — Issue labels for context

**If input is free text:**

Use the description directly and infer repository from context if possible.

---

### Step 2: Locate or clone the repository

**Two execution modes:**

1. **Local CLI mode**: Check parent directory for existing repo
2. **Slack mode**: Always clone to temp directory for full workflow (checkout, PR, etc.)

**Check if repo exists locally (CLI mode only):**

When running via CLI, check in the parent directory of the agent-server:

```bash
parent_dir=$(dirname "$(pwd)")

if [ -d "$parent_dir/<repo-name>" ]; then
  cd "$parent_dir/<repo-name>"
  git fetch origin
  echo "Found repo locally: $parent_dir/<repo-name>"
else
  echo "Repo not found locally, cloning..."
  temp_dir=$(mktemp -d)
  cd "$temp_dir"
  gh repo clone <org>/<repo-name>
  cd <repo-name>
  echo "Cloned repo to temp directory: $temp_dir/<repo-name>"
fi
```

**Via Slack — always clone:**

When running via Slack, always clone to a fresh temp directory to ensure clean state for branch creation and PR workflow:

```bash
temp_dir=$(mktemp -d)
cd "$temp_dir"
gh repo clone <org>/<repo-name>
cd <repo-name>
echo "✓ Cloned repo to temp directory: $temp_dir/<repo-name>"
```

**Switch to default branch and update:**

```bash
# Detect default branch
default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$default_branch" ]; then
  default_branch=$(git rev-parse --verify origin/main >/dev/null 2>&1 && echo "main" || echo "master")
fi

git checkout "$default_branch"
git pull origin "$default_branch"
```

---

### Step 3: Create fix branch

Derive branch name from issue:

- **From GitHub issue:** `fix/<issue-number>-<kebab-case-short-title>`
  Example: `fix/7443-texture-not-saved`
- **From description:** `fix/<kebab-case-description>`
  Example: `fix/custom-item-texture-bug`

```bash
git checkout -b <branch-name> "origin/$default_branch"
```

---

### Step 4: Ensure Compound Engineering plugin is installed

```bash
if ! claude plugins list 2>/dev/null | grep -q compound-engineering; then
  claude plugins install compound-engineering
fi
```

If installation fails, report the error and stop. The plan and work workflows require this plugin.

---

### Step 5: Run `/compound-engineering:workflows:plan`

**Invoke the plan workflow directly, passing the issue context as the argument.** Do NOT analyze the issue yourself — let the workflow handle everything:

```
/compound-engineering:workflows:plan <paste the full issue title + body here as the argument>
```

The workflow will autonomously:
- Research the codebase
- Find relevant files and patterns
- Identify the root cause
- Create a plan document in `docs/plans/`
- Ask what to do next

**When prompted for next steps, select "Start /workflows:work".**

---

### Step 6: Run `/compound-engineering:workflows:work`

**Invoke the work workflow directly, passing the plan file path.** Do NOT implement anything yourself — let the workflow handle everything:

```
/compound-engineering:workflows:work docs/plans/<the-plan-file-created-in-step-5>.md
```

The workflow will autonomously:
- Break the plan into tasks
- Implement all changes
- Run tests and type checks
- Create commits

---

### Step 7: Final CI verification

After the work workflow completes, run the same checks that GitHub Actions will run. Look at `.github/workflows/` to find the CI checks, then run them locally:

**Node.js / TypeScript (typical):**
```bash
npm run build
npm test
npm run lint
npm run typecheck
```

**If anything fails:** fix it, commit, and re-run until everything passes.

**Do NOT proceed if checks fail.**

---

### Step 8: Push and create PR

**Push the branch:**

```bash
git push -u origin <branch-name>
```

**Create the PR.** Build the description from the commits and plan:

```bash
gh pr create \
  --title "<type>: <concise title>" \
  --body "$(cat <<'EOF'
## Summary

<1-3 bullet points from the plan and commits>

## Root Cause

<From the plan document>

## Changes

<From git diff --stat>

## Testing

<What was verified — build, tests, lint, typecheck>

## Closes

<GitHub issue URL or "Fixes #number">

---
🤖 Created via Slack with Claude
EOF
)"
```

**Report the PR URL.**

---

## Example flow

```
User: fix https://github.com/decentraland/creator-hub/issues/170

Agent:
1. Fetched issue #170: "Fix hide image action"
2. Found repo locally: /path/to/creator-hub
3. Created branch: fix/170-hide-image-action
4. Compound Engineering plugin verified
5. Ran /workflows:plan → created docs/plans/2026-03-13-fix-hide-image-action-plan.md
6. Ran /workflows:work → implemented fix, tests pass
7. CI checks passed (build, test, lint, typecheck)
8. Created PR: https://github.com/decentraland/creator-hub/pull/1200

FIX COMPLETE
```

---

## Security & Safety Rules

- **Never force push** (`git push -f`)
- **Never push directly to main/master**
- **Always run tests before creating PR**
- **Never commit secrets, tokens, or .env files**
- **If cloning temporarily, work in isolated temp directory**

---

## Error Handling

**If Compound Engineering plugin fails to install:**
- Report the error and stop. Do not attempt manual fallback.

**If /workflows:plan fails:**
- Check error output, retry once. If it fails again, report to user.

**If /workflows:work fails or tests fail:**
- Analyze errors, fix issues, re-run the failing step.

**If PR creation fails:**
- Check `gh auth status`, verify branch was pushed, retry.

---

## Attribution

Always include in PR body:
```
---
🤖 Created via Slack with Claude
```

If triggered by a Slack user (when "Triggered by" is in the prompt), add:
```
Requested by <name> via Slack
```

---

## Context for Decentraland Creator Hub

**Common repos:**
- `decentraland/creator-hub` — **MONOREPO** (includes main app, inspector, ALL asset packs)
- `decentraland/js-sdk-toolchain` — SDK JavaScript tooling

**CRITICAL: Creator Hub is a MONOREPO**

`decentraland/creator-hub` is a **monorepo** that contains:
- Main Creator Hub application
- Scene Inspector
- **Asset Packs** (previously in separate `decentraland/asset-packs` repos)

**ANY issue related to asset packs MUST BE RESOLVED in the creator-hub repository.**

**Important:** If you don't have context for a Decentraland repo, read the README.md and CLAUDE.md first to understand the project structure, build commands, and testing approach.

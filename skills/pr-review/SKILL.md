---
name: pr-review
description: Review GitHub pull requests — read the diff, analyze code for bugs and issues, post review comments on GitHub, and summarize findings.
---

# Pull Request Review

## Operations

### View PR details
```bash
gh pr view {number} -R {owner}/{repo} --json title,body,files,reviews,comments,state,statusCheckRollup
```

### Fetch the full diff
```bash
gh pr diff {number} -R {owner}/{repo}
```

### List changed files (summary)
```bash
gh pr diff {number} -R {owner}/{repo} --stat
```

### Check CI status
```bash
gh pr checks {number} -R {owner}/{repo}
```

### List recent PRs
```bash
gh pr list -R {owner}/{repo} --limit 10 --json number,title,author,state,url
```

### Read comments
```bash
# Inline review comments (attached to specific lines)
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | {user: .user.login, body: .body, path: .path, line: .line}'

# Top-level conversation comments
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {user: .user.login, body: .body}'
```

## Code review workflow

When asked to review a PR (not just summarize):

### 1. Gather context

- Fetch PR details (title, body, state, CI status)
- Fetch the full diff
- If needed, clone the repo to `/tmp/` to read changed files in full context

### 2. Analyze the code

Look for:
- *Bugs* — logic errors, off-by-one, null/undefined access, race conditions
- *Security issues* — injection, auth bypass, secrets in code, unsafe deserialization
- *Missing error handling* — unhandled promise rejections, missing try/catch, ignored errors
- *Test coverage* — are the changes tested? Are edge cases covered?
- *API contract* — breaking changes, missing validation, wrong HTTP methods
- *Performance* — N+1 queries, unnecessary allocations, missing pagination
- *Style* — only flag style issues if they affect readability or correctness

Reference specific files and lines when noting issues.

### 3. Post the review on GitHub

Choose the appropriate review action:

```bash
# Approve
gh pr review {number} -R {owner}/{repo} --approve --body "Review summary..."

# Request changes
gh pr review {number} -R {owner}/{repo} --request-changes --body "Review summary..."

# Comment only (no approval decision)
gh pr review {number} -R {owner}/{repo} --comment --body "Review summary..."
```

For line-level comments, use the GitHub API:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST --input - <<'EOF'
{
  "event": "COMMENT",
  "body": "Overall review summary",
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "body": "Bug: this will throw if `user` is null — add a guard check."
    }
  ]
}
EOF
```

### 4. Report back to Slack

Provide a concise summary:

1. **Verdict** — approved, changes requested, or comments only
2. **Key findings** — most important issues, grouped by severity
3. **CI status** — passing, failing, or pending
4. **Link** — the PR URL

## Summary-only guidelines

When summarizing a PR (not doing a full review):

1. **What changed** — summarize the purpose and key changes (don't just list files)
2. **CI status** — note whether checks are passing, failing, or pending
3. **Review status** — approved, changes requested, or awaiting review
4. **Blockers** — flag anything preventing merge (failing CI, requested changes, `do not merge` label)
5. **Ready to merge?** — give a clear yes/no/not-yet assessment with reasoning

Keep summaries concise. Focus on what matters for deciding whether to merge.

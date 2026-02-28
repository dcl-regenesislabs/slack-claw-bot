---
name: pr-review
description: Review and summarize GitHub pull requests — fetch details, check CI, list changes, and provide a summary.
---

# Pull Request Review

## Operations

### View PR details
```bash
gh pr view {number} -R {owner}/{repo} --json title,body,files,reviews,comments,state,statusCheckRollup
```

### List changed files
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

### Read review comments
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | {user: .user.login, body: .body, path: .path, line: .line}'
```

### Read issue-style comments
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {user: .user.login, body: .body}'
```

## Guidelines

When summarizing a PR:

1. **What changed** — summarize the purpose and key changes (don't just list files)
2. **CI status** — note whether checks are passing, failing, or pending
3. **Review status** — approved, changes requested, or awaiting review
4. **Blockers** — flag anything preventing merge (failing CI, requested changes, `do not merge` label)
5. **Ready to merge?** — give a clear yes/no/not-yet assessment with reasoning

Keep summaries concise. Focus on what matters for deciding whether to merge.

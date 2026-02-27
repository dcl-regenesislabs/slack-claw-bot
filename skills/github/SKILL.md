---
name: github
description: General GitHub operations using the gh CLI. Search issues, read issue details, find pull requests, and manage labels.
---

# GitHub CLI Operations

Use the `gh` CLI for all GitHub operations. The tool is pre-authenticated via GITHUB_TOKEN.

## Common Operations

### Search Issues
```
gh issue list --repo {repo} --search "<query>" --limit 10 --json number,title,url,state,labels
```

### Read Issue Details
```
gh issue view {number} --repo {repo} --json title,body,comments,labels,state
```

### Create Issue
```
gh issue create --repo {repo} --title "..." --body "..."
```

### Search with Labels
```
gh issue list --repo {repo} --label "bug" --state open --json number,title,url
```

### Find Related PRs
```
gh pr list --repo {repo} --search "<query>" --json number,title,url,state
```

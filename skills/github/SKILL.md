---
name: github
description: General GitHub operations using the gh CLI. Search issues, read issue details, find pull requests, and manage labels.
---

# GitHub CLI Operations

Use the `gh` CLI for all GitHub operations. The tool is pre-authenticated via GITHUB_TOKEN.

## Common Operations

### Search Issues
```bash
gh issue list --repo {repo} --search "<query>" --limit 10 --json number,title,url,state,labels
```

### Read Issue Details
```bash
gh issue view {number} --repo {repo} --json title,body,comments,labels,state
```

### Create Issue
```bash
gh issue create --repo {repo} --title "..." --body "..." --label "bug,enhancement" --assignee "username"
```

### Edit Issue (labels, assignees)
```bash
gh issue edit {number} --repo {repo} --add-label "bug,high" --add-assignee "username"
```

### Search with Labels
```bash
gh issue list --repo {repo} --label "bug" --state open --json number,title,url
```

### Find Related PRs
```bash
gh pr list --repo {repo} --search "<query>" --json number,title,url,state
```

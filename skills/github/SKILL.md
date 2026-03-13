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

## Creating Pull Requests

When you need to make changes to a repo and open a PR:

### 1. Clone and branch
```bash
WORK=$(mktemp -d)
gh repo clone {owner}/{repo} "$WORK"
cd "$WORK"
git checkout -b {branch-name}
```

Branch naming: `feat/`, `fix/`, or `chore/` prefix, kebab-case (e.g. `fix/validate-timeout`).

### 2. Make changes

Edit files as needed. Always run the project's build and test commands before committing.

### 3. Commit and push
```bash
git add {specific-files}
git commit -m "Short imperative description"
git push -u origin HEAD
```

### 4. Open the PR
```bash
gh pr create --repo {owner}/{repo} --title "Short title" --body "$(cat <<'EOF'
## Summary
- <what changed and why>

## What could break
- <risks or side effects>

## How to test
- <steps to verify>
EOF
)"
```

### Rules
- Never force push or push directly to main/master
- Always run build and tests before pushing — do not push code that fails
- Keep PRs small and focused — one logical change per PR
- Report the PR URL back to the user

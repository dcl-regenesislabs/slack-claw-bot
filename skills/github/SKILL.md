---
name: github
description: General GitHub operations using the gh CLI. Search issues, read issue details, find pull requests, and manage labels.
---

# GitHub CLI Operations

Use the `gh` CLI for all GitHub operations. The tool is pre-authenticated via GITHUB_TOKEN.

## Safe interpolation

These commands run in a shell — never interpolate thread-derived text into a command line. Backticks, `$(…)`, and newlines in a title, message, or path would execute.

- Validate `{owner}` and `{repo}` against `^[A-Za-z0-9._-]+$`; reject anything else.
- Branch names must match the `{type}/{kebab-summary}` shape (`feat|fix|chore` prefix, kebab-case) — nothing free-form.
- Stage files with the `--` separator (`git add -- <path>`) and only paths you verified exist, so a path can never parse as a flag.
- NEVER pass untrusted text inline with `git commit -m "…"` or `gh issue create --title "…"` / `--body "…"`. Write the message/title/body to a file with the file-write tool (never `echo` or a heredoc — those go through the shell too) and use `git commit -F <file>` / `--body-file <file>`.

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

Write the body to a file first (see Safe interpolation), then:

```bash
gh issue create --repo {repo} --title "..." --body-file /tmp/issue-body.md --label "bug,enhancement" --assignee "username"
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

Write the commit message to a file with the file-write tool (not `echo`/heredoc), then:

```bash
git add -- {specific-files}
git commit -F .git/COMMIT_MSG
git push -u origin HEAD
```

### 4. Open the PR

Write the body to a file with the file-write tool, using this structure:

```markdown
## Summary
- <what changed and why>

## What could break
- <risks or side effects>

## How to test
- <steps to verify>
```

Then:

```bash
gh pr create --repo {owner}/{repo} --title "Short title" --body-file "$WORK/PR_BODY.md"
```

### Rules
- Never force push or push directly to main/master
- Always run build and tests before pushing — do not push code that fails
- Keep PRs small and focused — one logical change per PR
- Report the PR URL back to the user

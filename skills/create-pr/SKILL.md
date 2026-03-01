---
name: create-pr
description: Create a pull request — clone a repo, make changes, validate with build and tests, then push and open a PR.
---

# Create a Pull Request

## Safety rules

- All work happens under `/tmp/repos/` — never modify the slack-bot's own repo
- Always use a feature branch (never push directly to main/master)
- Always clean up the worktree when done (success or failure)

## Workflow

### 1. Set up the working directory

Repos are cached at `/tmp/repos/{owner}-{repo}`. Reuse the existing clone if present, otherwise clone fresh. Use a git worktree so multiple concurrent agents can work on the same repo without conflicts.

```bash
REPO_DIR="/tmp/repos/{owner}-{repo}"

# Clone if not already cached
if [ ! -d "$REPO_DIR/.git" ]; then
  mkdir -p /tmp/repos
  gh repo clone {owner}/{repo} "$REPO_DIR"
fi

# Update the cached clone
git -C "$REPO_DIR" fetch origin

# Create a worktree for this run
BRANCH_NAME="feat/short-description"
WORKTREE="/tmp/repos/{owner}-{repo}-wt-$$"
git -C "$REPO_DIR" worktree add "$WORKTREE" -b "$BRANCH_NAME" origin/main
cd "$WORKTREE"
```

### 2. Discover project structure

Read files to understand how the project builds and tests:

- `README.md` — setup instructions, prerequisites
- `package.json` — `scripts.build`, `scripts.test`, `scripts.lint` (Node/JS projects)
- `Makefile` — build/test targets (Go, C, mixed projects)
- `Cargo.toml` — Rust projects (`cargo build`, `cargo test`)
- `.github/workflows/` — CI pipeline (shows what checks will run on the PR)

Identify the **build command** and **test command** before making changes.

### 3. Make the changes

Use the `edit` and `write` tools for file modifications — they are more reliable than `sed`.

- For modifying existing files: use `edit` (find-and-replace)
- For creating new files: use `write`
- For complex multi-step changes: read the file first, then edit

### 4. Validate before pushing

Do NOT push until both build and tests pass.

```bash
# Run the build (use the command discovered in step 2)
npm run build   # or make, cargo build, etc.

# Run the tests
npm test        # or make test, cargo test, etc.
```

If either fails:
1. Read the error output
2. Fix the issue
3. Re-run the failing step
4. Repeat until both pass

If there is no build step (e.g. a pure Python project), run linting if available. If there are no tests, note this in the PR body.

### 5. Commit

```bash
git add -A
git commit -m "Short imperative description of the change"
```

- Use imperative mood ("Add feature" not "Added feature")
- Keep the subject line concise
- One logical change per commit — split if the change covers unrelated things

### 6. Push and create the PR

```bash
git push -u origin HEAD
gh pr create --title "Short title" --body "$(cat <<'EOF'
## Summary
Brief description of what changed and why.

## What could break
Risks or side effects to watch for (or "None expected" if straightforward).

## How to test
Steps to verify the change works correctly.
EOF
)"
```

### 7. Clean up and report back

```bash
# Remove the worktree
git -C "$REPO_DIR" worktree remove "$WORKTREE" --force
```

## Guidelines

- If the user doesn't specify a repo, ask which repo to target
- If the change is ambiguous, clarify before starting
- Keep PRs focused — one concern per PR
- If tests don't exist for the changed code, mention it in the PR body but don't block on it
- If the build/test cycle reveals pre-existing issues unrelated to your change, note them but don't fix them in the same PR
- Always output the created PR URL as the last line, prefixed with `PR_URL:`

---
name: fix
description: End-to-end workflow for fixing GitHub issues. Accepts a GitHub issue URL or description, creates a branch, plans the fix, implements it, runs tests, and creates a PR. Use when the user says "fix <issue-url>" or "fix <description>".
---

# Fix Issue Workflow (Autonomous)

Autonomous end-to-end workflow for fixing GitHub issues: understand the problem, find/clone the repo, create a branch, plan the solution, implement it, test it, commit, and create the PR.

## When to use

- User says `fix` followed by a GitHub issue URL (e.g., `fix https://github.com/decentraland/creator-hub/issues/123`)
- User says `soluciona este issue` or `fix this issue` with a URL
- User says `fix` followed by a description of the problem

## ⚠️ IMPORTANT: Creator Hub Monorepo

**Creator Hub (`decentraland/creator-hub`) is a MONOREPO.**

**ALL asset pack issues MUST be fixed in the creator-hub repository**, not in individual asset pack repos.

The following repositories are **ARCHIVED** and should NEVER be used:
- `decentraland/asset-packs`
- `decentraland/asset-pack-*` (any individual asset pack repo)
- `decentraland/inspector`

**If an issue is in any archived asset pack repository:**
1. Stop immediately
2. Tell the user the repo is archived
3. Direct them to open/migrate the issue to `decentraland/creator-hub`
4. Do NOT attempt to fix in the archived repo

## Input parsing

The skill receives one argument:

1. **GitHub issue URL** — Extract issue details using `gh`
2. **Free-text description** — Use directly as context

If no argument is provided, ask: "¿Qué issue quieres que fixee? Pasa una URL de GitHub o describe el problema."

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

### Step 2: Validate repository (avoid archived repos)

**IMPORTANT: Creator Hub is a monorepo. All asset packs, inspector, and creator hub issues are resolved in the creator-hub repository.**

Before proceeding, check the repository name:

**If the issue is in any of these archived repos:**
- `decentraland/asset-packs`
- `decentraland/inspector`
- `decentraland/asset-pack-*` (any asset pack repo, e.g., asset-pack-common, asset-pack-animals, etc.)

**Stop immediately and redirect:**

```
⚠️ This issue is in an archived repository.

Creator Hub is now a monorepo. All asset pack, inspector, and creator hub issues 
must be resolved in:
https://github.com/decentraland/creator-hub

Please:
1. Check if this issue has been migrated to creator-hub
2. If not, create a new issue in creator-hub with the same details
3. Reference the old issue number

I cannot work in archived repositories.
```

**Valid repositories to work in:**
- `decentraland/creator-hub` — Main monorepo (includes inspector, asset packs, creator hub app)
- `decentraland/sdk-toolchain` — SDK build tools
- `decentraland/js-sdk-toolchain` — SDK JavaScript tooling
- `decentraland/godot-explorer` — Mobile client
- Any other active Decentraland repository (check it's not archived)

**If unsure whether a repo is archived:**

```bash
gh repo view <org>/<repo> --json isArchived --jq .isArchived
```

If output is `true`, do not proceed with the fix.

---

### Step 3: Locate or clone the repository

**Two execution modes:**

1. **Local CLI mode**: Check parent directory for existing repo
2. **Slack mode**: Always clone to temp directory for full workflow (checkout, PR, etc.)

**Check if repo exists locally (CLI mode only):**

When running via CLI, check in the parent directory of the agent-server:

```bash
# Get parent directory of agent-server
parent_dir=$(dirname "$(pwd)")

# Check if repo exists in parent directory
if [ -d "$parent_dir/<repo-name>" ]; then
  cd "$parent_dir/<repo-name>"
  git fetch origin
  echo "✓ Found repo locally: $parent_dir/<repo-name>"
else
  # Not found locally, proceed to clone
  echo "⚠ Repo not found locally, cloning..."
  temp_dir=$(mktemp -d)
  cd "$temp_dir"
  gh repo clone <org>/<repo-name>
  cd <repo-name>
  echo "✓ Cloned repo to temp directory: $temp_dir/<repo-name>"
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

### Step 4: Create fix branch

Derive branch name from issue:

- **From GitHub issue:** `fix/<issue-number>-<kebab-case-short-title>`  
  Example: `fix/7443-texture-not-saved`
- **From description:** `fix/<kebab-case-description>`  
  Example: `fix/custom-item-texture-bug`

```bash
git checkout -b <branch-name> "origin/$default_branch"
```

Report: `✓ Created branch: <branch-name>`

---

### Step 5: Run plan skill — analyze and create implementation plan

**Load and use the plan skill:**

Read `/Users/alejandralevy/Documents/decentraland/agent-server/skills/plan/SKILL.md` and follow its workflow to:

1. **Understand the problem** — Read issue body, analyze what's broken
2. **Explore the codebase** — Find relevant files, components, modules
3. **Search for context:**
   - Grep for error messages, function names, component names
   - Look at recent commits related to the area
   - Check for similar issues or PRs
4. **Identify root cause** — Determine why it's broken
5. **Propose solution** — Describe the fix approach

**Output the plan clearly:**

```
📋 PLAN

**Problem:** <concise summary>

**Root Cause:** <what's causing the issue>

**Affected Files:**
- src/components/Foo.ts
- src/utils/Bar.ts

**Solution Approach:**
1. <Step 1>
2. <Step 2>
3. <Step 3>

**Testing Strategy:**
- <How to verify the fix>
```

---

### Step 6: Implement the fix

**Follow the plan autonomously:**

- Use `read` to examine the affected files
- Use `edit` to make precise changes
- Use `write` if creating new files
- Make changes incrementally, one logical step at a time

**Verify changes:**

After each edit, briefly describe what was changed and why it fixes the issue.

---

### Step 7: Run build and tests

**Always test before committing:**

Determine the project type and run appropriate commands:

**Node.js / TypeScript:**
```bash
npm ci  # install dependencies if needed
npm run build  # or npm run compile
npm test  # run test suite
```

**Go:**
```bash
go build ./...
go test ./...
```

**Python:**
```bash
pip install -r requirements.txt
pytest
```

**If build or tests fail:**
- Analyze the error
- Fix the issue
- Re-run tests
- **Never proceed to commit if tests fail**

Report: `✓ Build successful` or `✓ Tests passed`

---

### Step 8: Commit changes

**Stage all changes:**

```bash
git add -A
```

**Create conventional commit:**

```bash
git commit -m "<type>: <short description>

<optional longer explanation>

Fixes: <GitHub issue URL or #number>"
```

Commit types:
- `fix` — Bug fixes
- `feat` — New features
- `refactor` — Code improvements without changing behavior
- `test` — Test additions or fixes
- `docs` — Documentation changes

Example:
```
fix: persist custom item textures on save

Previously, textures were lost when saving custom items because
the texture state wasn't being serialized to the scene file.

Added texture serialization to CustomItemManager.saveState().

Fixes: #7443
```

Report: `✓ Committed changes`

---

### Step 9: Push branch

```bash
git push -u origin <branch-name>
```

Report: `✓ Pushed branch: <branch-name>`

---

### Step 10: Create pull request

**Generate PR description from the plan and changes:**

```bash
gh pr create \
  --title "<type>: <concise title matching commit>" \
  --body "## Summary

<Brief explanation of what was fixed>

## Problem

<What was broken and why>

## Solution

<What was changed to fix it>

## Changes

$(git diff origin/$default_branch..HEAD --stat)

## Testing

✓ Build successful
✓ Tests passing
<Additional manual testing if done>

## Closes

Fixes <GitHub issue URL>

---

🤖 Created via Slack with Claude"
```

**Capture PR URL and report:**

```
✅ FIX COMPLETE

Branch: <branch-name>
PR: <PR URL>

<Brief summary of what was done>
```

---

## Example flow

```
User: fix https://github.com/decentraland/creator-hub/issues/7443

Agent:
1. ✓ Fetched issue #7443: "Custom item textures not saved"
2. ✓ Validated repository: creator-hub is active (not archived)
3. ✓ Found repo locally: /Users/alejandralevy/Documents/decentraland/creator-hub
4. ✓ Created branch: fix/7443-texture-not-saved
5. 📋 PLAN:
   - Problem: Textures lost on save
   - Root cause: Missing serialization in CustomItemManager
   - Solution: Add texture serialization to saveState()
6. ✓ Implemented fix in src/components/CustomItems/CustomItemManager.ts
7. ✓ Build successful
8. ✓ Tests passed
9. ✓ Committed: fix: persist custom item textures on save
10. ✓ Pushed branch
11. ✓ Created PR: https://github.com/decentraland/creator-hub/pull/7450

✅ FIX COMPLETE
```

---

## Security & Safety Rules

- **Never force push** (`git push -f`)
- **Never push directly to main/master**
- **Always run tests before committing** — do not proceed if tests fail
- **Never commit secrets, tokens, or .env files**
- **Get user confirmation before destructive operations**
- **If cloning temporarily, work in isolated temp directory**

---

## Error Handling

**If tests fail:**
1. Analyze error output
2. Fix the issue
3. Re-run tests
4. Only proceed when tests pass

**If build fails:**
1. Read error messages
2. Check for missing dependencies
3. Fix compilation errors
4. Re-run build

**If PR creation fails:**
1. Check if branch was pushed successfully
2. Verify GitHub CLI auth: `gh auth status`
3. Try again or report error to user

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
- `decentraland/sdk-toolchain` — SDK build tools
- `decentraland/js-sdk-toolchain` — SDK JavaScript tooling

**‼️ CRITICAL: Creator Hub is a MONOREPO**

`decentraland/creator-hub` is a **monorepo** that contains:
- Main Creator Hub application
- Scene Inspector
- **ALL Asset Packs** (previously in separate `decentraland/asset-pack-*` repos)

**ANY issue related to asset packs MUST BE RESOLVED in the creator-hub repository.**

The old individual asset pack repositories (`decentraland/asset-pack-common`, `decentraland/asset-pack-animals`, etc.) are **ARCHIVED** and must NOT be used for fixes.

**Typical stack:**
- TypeScript / Node.js
- React for UI
- Build: `npm run build`
- Tests: `npm test`

**Important:** If you don't have context for a Decentraland repo, read the README.md first to understand the project structure, build commands, and testing approach.

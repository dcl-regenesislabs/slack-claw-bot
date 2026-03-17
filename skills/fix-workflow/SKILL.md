---
name: fix
description: End-to-end workflow for fixing GitHub issues in any repository. Accepts a GitHub issue URL or description, creates a branch, reads repo context, plans the fix, implements it, runs tests, and creates a PR. Use when the user says "fix <issue-url>" or "fix <description>".
---

# Fix Issue Workflow (Autonomous)

Autonomous end-to-end workflow for fixing GitHub issues in any repository: fetch the issue, find/clone the repo, read repo context, create a branch, run plan and work workflows, and create the PR.

## CRITICAL: Never act without reading repo context first

Do **NOT** skip the context-reading step. Every repository has its own conventions, build system, and architecture. The workflow **must** read the repo's documentation before planning or implementing anything.

## When to use

- User says `fix` followed by a GitHub issue URL (e.g., `fix https://github.com/decentraland/some-repo/issues/123`)
- User says `fix this issue` with a URL or a text description
- User says `fix` followed by a description of the problem

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
- `repository` — Full repo name (e.g., `decentraland/some-repo`)
- `labels` — Issue labels for context

**If input is free text:**

Use the description directly and infer repository from context if possible.

---

### Step 2: Determine the correct target repository

**The repo where the issue lives is NOT always the repo where the fix belongs.** You MUST consult the `repos` skill before proceeding.

**Step 2a — Read the `repos` skill.** It contains:
- Repository dependency graph (which repos consume which)
- Package-to-repo mapping (which packages live in which repo)
- Cross-repo fix patterns (common cases where the fix belongs elsewhere)
- Archived repos and their replacements

**Step 2b — Match the issue against the dependency graph:**
- Read the issue title, body, comments, error messages, and stack traces
- Identify any packages, libraries, or components mentioned
- Cross-reference against the `repos` skill's package table to find the **source repo**

**Step 2c — Decide:**
- If the affected code lives in a different repo → use **that** repo for Steps 3-9
- If the fix spans multiple repos → create a PR in **each** repo, cross-referencing them
- If unclear → clone the issue's repo first, investigate the code (Step 4), and switch if the root cause traces to a dependency
- Always link back to the original issue URL in PR descriptions

---

### Step 3: Locate or clone the target repository

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

### Step 4: Read repo context (MANDATORY)

**Before planning or writing any code, read the repo's own documentation.** This step is non-negotiable — every repo has different conventions, build tools, and architecture.

Read these files in order (skip any that don't exist):

```bash
# 1. CLAUDE.md — agent-specific instructions, build commands, architecture, conventions
cat CLAUDE.md 2>/dev/null

# 2. README.md — project overview, setup, tech stack
cat README.md 2>/dev/null

# 3. CI configuration — understand what checks will run
ls .github/workflows/ 2>/dev/null && cat .github/workflows/*.yml 2>/dev/null

# 4. Agent context docs (some repos have these)
cat docs/ai-agent-context.md 2>/dev/null
```

**From these files, extract and note:**
- **Build commands** — how to build the project (e.g., `npm run build`, `cargo build`, `make`)
- **Test commands** — how to run tests (e.g., `npm test`, `cargo test`, `pytest`)
- **Lint/typecheck commands** — what quality checks exist
- **Project structure** — where source code, tests, and configs live
- **Conventions** — coding style, branch naming, commit message format
- **Monorepo structure** — if applicable, which packages exist and how they relate

**These extracted details will be used in Steps 6, 7, and 8.** If `CLAUDE.md` exists, its instructions take precedence over defaults.

---

### Step 5: Create fix branch

Derive branch name from issue:

- **From GitHub issue:** `fix/<issue-number>-<kebab-case-short-title>`
  Example: `fix/7443-texture-not-saved`
- **From description:** `fix/<kebab-case-description>`
  Example: `fix/custom-item-texture-bug`

```bash
git checkout -b <branch-name> "origin/$default_branch"
```

---

### Step 6: Run `/compound-engineering:workflows:plan`

**IMPORTANT: This is NOT the local `plan` skill.** Use the Compound Engineering workflow `/compound-engineering:workflows:plan` (invoked via the Skill tool), NOT the local `plan` skill from `skills/plan/SKILL.md`. The local `plan` skill is for Decentraland backend service architecture — it is unrelated to this step.

**Invoke the Compound Engineering plan workflow, passing the issue context AND the repo context you gathered in Step 4:**

```
/compound-engineering:workflows:plan <issue title + body> — Repo context: <key details from CLAUDE.md/README: tech stack, build commands, project structure>
```

The workflow will autonomously:
- Research the codebase
- Find relevant files and patterns
- Identify the root cause
- Create a plan document in `docs/plans/`
- Ask what to do next

**When prompted for next steps, respond with "Start /workflows:work" to continue autonomously.** Do not wait for user input — this is an autonomous workflow.

---

### Step 7: Run `/compound-engineering:workflows:work`

**Invoke the work workflow, passing the plan file path:**

```
/compound-engineering:workflows:work docs/plans/<the-plan-file-created-in-step-6>.md
```

The workflow will autonomously:
- Break the plan into tasks
- Implement all changes
- Run tests and type checks
- Create commits

---

### Step 8: Final CI verification

After the work workflow completes, run the **repo's actual CI checks** — not hardcoded commands.

**Use the context from Step 4 to determine the correct commands:**

1. Check `CLAUDE.md` for explicit build/test/lint commands
2. Check `.github/workflows/*.yml` for the CI steps
3. If neither exists, infer from the project type:

| Indicator | Build | Test | Lint | Typecheck |
|-----------|-------|------|------|-----------|
| `package.json` | `npm run build` | `npm test` | `npm run lint` | `npm run typecheck` |
| `Cargo.toml` | `cargo build` | `cargo test` | `cargo clippy -- -D warnings` | _(included in build)_ |
| `requirements.txt` / `pyproject.toml` | — | `pytest` | `ruff check .` | `mypy .` |
| `go.mod` | `go build ./...` | `go test ./...` | `golangci-lint run` | _(included in build)_ |
| `Makefile` | Check for `make build`, `make test`, `make lint` targets | | | |

**Run the commands identified above.** Example for a Node.js project:

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

**If anything fails:** fix it, commit, and re-run until everything passes.

**Do NOT proceed if checks fail.**

---

### Step 9: Push and create PR

**This step is MANDATORY — the workflow is not complete until the PR is created.**

**Ensure you are in the target repo directory** (the repo where you made the fix, which may differ from where the issue was filed):

```bash
# Verify you're in the right repo
git remote get-url origin
```

**Before pushing, remove the plan file from the commit.** The plan is a working document — only push the actual code changes:

```bash
# Remove plan file from git tracking (do NOT delete the file, just unstage it)
git rm --cached docs/plans/*.md 2>/dev/null
git commit -m "remove plan from tracked files" 2>/dev/null
```

**Push the branch:**

```bash
git push -u origin <branch-name>
```

**Create the PR in the target repo.** Always use `--repo` to be explicit:

```bash
gh pr create \
  --repo <org>/<target-repo-name> \
  --title "<type>: <concise title>" \
  --body "$(cat <<'EOF'
## Summary

<1-3 bullet points from the plan and commits>

## Root Cause

<From the plan document>

## Changes

<From git diff --stat>

## Testing

<What was verified — list the actual commands run and their results>

## Closes

<Original issue URL — e.g., https://github.com/decentraland/creator-hub/issues/123>

---
🤖 Created via Slack with Claude
EOF
)"
```

**Cross-repo fix:** If the issue was filed in repo A but the fix is in repo B, the PR is created in repo B. Use the full original issue URL in the "Closes" section — GitHub will link them cross-repo.

**Report the PR URL. The workflow is NOT complete without a PR.**

---

## Example flow

```
User: fix https://github.com/decentraland/creator-hub/issues/170

Agent:
1. Fetched issue #170: "Fix hide image action" (repo: decentraland/creator-hub)
2. Analyzed issue → fix belongs in creator-hub (not a dependency issue)
3. Found repo locally: /path/to/creator-hub
4. Read repo context: CLAUDE.md (monorepo, npm workspaces, build: npm run build, test: npm test)
5. Created branch: fix/170-hide-image-action
6. Ran /compound-engineering:workflows:plan → created docs/plans/2026-03-13-fix-hide-image-action-plan.md
7. Ran /compound-engineering:workflows:work → implemented fix, tests pass
8. CI checks passed (build, test, lint, typecheck)
9. Created PR: https://github.com/decentraland/creator-hub/pull/1200

FIX COMPLETE
```

**Cross-repo example (fix belongs in a different repo than the issue):**

```
User: fix https://github.com/org/app/issues/456

Agent:
1. Fetched issue #456: "CLI crashes on deploy" (repo: org/app)
2. Analyzed issue → root cause is in @org/sdk-toolchain dependency, fix belongs in org/sdk-toolchain
3. Cloned org/sdk-toolchain
4. Read repo context: CLAUDE.md (monorepo, build: rush build, test: rush test)
5. Created branch: fix/456-cli-deploy-crash
6. Ran /compound-engineering:workflows:plan → created plan
7. Ran /compound-engineering:workflows:work → implemented fix, tests pass
8. CI checks passed
9. Created PR in org/sdk-toolchain linking back to org/app#456

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

**If repo context files don't exist:**
- Proceed with caution. Use project type indicators (package.json, Cargo.toml, etc.) to infer conventions. Note in the PR that the repo lacks documentation.

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

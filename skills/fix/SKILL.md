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

### Step 1: Parse input and determine what to fix

**Case A — GitHub issue URL:**

```bash
gh issue view <URL> --json title,body,labels,number,url
```

Extract title, body, number, labels. The repo is in the URL.

**Case B — Free text description (no URL):**

The user described a bug or feature in plain text. Extract the problem description and proceed to Step 2 to identify the repo.

**Case C — Slack conversation context (no explicit "fix" request):**

Sometimes users describe bugs in conversation without explicitly asking for a fix. Treat the conversation as a bug report — extract the problem description and proceed to Step 2.

---

### Step 2: Identify the correct target repository using @dcl/jarvis

**The repo where the issue lives is NOT always the repo where the fix belongs.** Use the same service discovery mechanism as the `plan` skill to identify ALL candidate repos.

**Step 2a — Ensure @dcl/jarvis is up to date:**

```bash
INSTALLED=$(node -e "console.log(require('./node_modules/@dcl/jarvis/package.json').version)" 2>/dev/null || echo "none")
LATEST=$(npm view @dcl/jarvis version 2>/dev/null)
if [ "$INSTALLED" != "$LATEST" ]; then
  npm install @dcl/jarvis@latest --no-save --silent
fi
```

**Step 2b — Scan the service manifests:**

```bash
# Read the service index — one entry per service with description, layer, repository, dependencies
cat node_modules/@dcl/jarvis/manifests/index.yaml

# Read the dependency graph — understand which services call which
cat node_modules/@dcl/jarvis/manifests/graph.yaml
```

From these files, identify candidate services/repos by matching:
- Keywords from the issue (error messages, feature names, UI components, API endpoints)
- Service descriptions and responsibilities
- Dependencies — both outbound (what this service calls) and inbound (what calls this service)

**Step 2c — For each candidate, read the service manifest:**

```bash
cat node_modules/@dcl/jarvis/manifests/<service-name>.yaml
```

Look at: `repository`, `domain.owned_entities`, `responsibilities`, `dependencies`, `events.publishes/consumes`. This tells you what each service owns and how they relate.

**Step 2d — Also read the `repos` skill for client-side repos:**

```bash
cat skills/repos/SKILL.md
```

The jarvis manifests cover backend services. The `repos` skill covers client repos (creator-hub, unity-explorer, godot-explorer, js-sdk-toolchain) and their dependencies. Read both.

**Step 2e — Decide which repo(s) to fix:**

- **Single repo** → the issue clearly maps to one service/repo → proceed to Step 3 with that repo
- **Different repo than the issue** → the root cause is in a dependency (e.g., issue in `creator-hub` but bug is in `@dcl/sdk-commands` which lives in `js-sdk-toolchain`) → use the source repo for Steps 3-8 (branch, plan, work, CI, push, PR), link back to the original issue
- **Multiple repos** → the fix spans services/repos → run Steps 3-8 (branch, plan, work, CI, push, PR) for EACH repo separately, creating a PR in each. Cross-reference the PRs
- **Unclear** → pick the most likely repo, clone it, run Step 5 (plan workflow will research it). If research reveals the root cause is elsewhere, switch repos and restart from Step 3
- **No URL and can't determine repo** → ask the user: "Which repository should I look at? Based on your description, it could be `<repo1>` or `<repo2>`."

**Always link back to the original issue URL in PR descriptions, even for cross-repo fixes.**

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

### Step 4: Create fix branch

```bash
git checkout -b <branch-name> "origin/$default_branch"
```

Branch name format:
- **From GitHub issue:** `fix/<issue-number>-<kebab-case-short-title>` (e.g., `fix/7443-texture-not-saved`)
- **From description:** `fix/<kebab-case-description>` (e.g., `fix/custom-item-texture-bug`)

---

### Step 5: Plan the fix (MANDATORY)

**BEFORE planning, you MUST read the full workflows-plan skill into this conversation:**

```bash
cat skills/workflows-plan/SKILL.md
```

**Now execute EVERY step you just read — all 8 steps, from Local Research through Report. Do NOT skip any step. Do NOT write your own simplified version. Follow the skill exactly as written.**

Input for the plan: `<issue title> — <issue body/description>`

**CHECK after research:** Based on the sub-agent research results and the `repos` skill you read in Step 2, does the fix belong in THIS repo? If the root cause is in a dependency that lives in another repo, switch repos and restart from Step 3.

**Do NOT proceed to Step 6 until a plan file exists at `docs/plans/*-plan.md`.**

```bash
ls docs/plans/*-plan.md
```

**Do NOT commit the plan file.** It will be included in the PR description in Step 8, not as a file in the repo.

---

### Step 6: Implement the fix (MANDATORY)

**BEFORE implementing, you MUST read the full workflows-work skill into this conversation:**

```bash
cat skills/workflows-work/SKILL.md
```

**Now execute EVERY phase you just read — Understand, Execute, Quality Check, Final Commit, Report. Do NOT skip any phase. Follow the skill exactly as written.**

Input: the plan file from Step 5.

**Do NOT proceed to Step 7 until ALL checkboxes in the plan are checked and tests pass.**

---

### Step 7: Final CI verification

After the work workflow completes, run the **repo's actual CI checks** — not hardcoded commands.

**Use the context from the plan to determine the correct commands:**

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

**Before proceeding, remove any unused imports introduced by your changes.**

**Do NOT proceed if checks fail.**

---

### Step 8: Push and create PR

**This step is MANDATORY — the workflow is not complete until the PR is created.**

**Ensure you are in the target repo directory** (the repo where you made the fix, which may differ from where the issue was filed):

```bash
# Verify you're in the right repo
git remote get-url origin
```

**Do NOT commit the plan file to the repo.** The plan goes in the PR description only, not as a file in the codebase. If the plan was accidentally committed, remove it:

```bash
git rm --cached docs/plans/*.md 2>/dev/null
git commit -m "chore: exclude plan from tracked files" 2>/dev/null
```

**Push the branch:**

```bash
git push -u origin <branch-name>
```

**Read the plan file to include it in the PR description:**

```bash
cat docs/plans/*-plan.md
```

**Create the PR in the target repo.** The PR body MUST include the full plan. Always use `--repo` to be explicit:

```bash
gh pr create \
  --repo <org>/<target-repo-name> \
  --title "<type>: <concise title>" \
  --body "$(cat <<'EOF'
## Summary

<1-3 bullet points from the plan and commits>

## Plan

<Paste the FULL content of the plan document here — root cause analysis, relevant files, proposed changes, acceptance criteria. This is the research that informed the fix.>

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
4. Created branch: fix/170-hide-image-action
5. Followed workflows-plan skill → ran sub-agents (research, spec-flow) → created docs/plans/2026-03-13-fix-hide-image-action-plan.md
6. Followed workflows-work skill → implemented fix per plan checkboxes, tests pass
7. CI checks passed (build, test, lint, typecheck)
8. Created PR: https://github.com/decentraland/creator-hub/pull/1200

FIX COMPLETE
```

**Cross-repo example (fix belongs in a different repo than the issue):**

```
User: fix https://github.com/org/app/issues/456

Agent:
1. Fetched issue #456: "CLI crashes on deploy" (repo: org/app)
2. Analyzed issue → root cause is in @org/sdk-toolchain dependency, fix belongs in org/sdk-toolchain
3. Cloned org/sdk-toolchain
4. Created branch: fix/456-cli-deploy-crash
5. Followed workflows-plan skill → researched codebase, created plan
6. Followed workflows-work skill → implemented fix, tests pass
7. CI checks passed
8. Created PR in org/sdk-toolchain linking back to org/app#456

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

**If the workflows-plan skill fails (no plan file created):**
- Check error output, retry once. If it fails again, report to user.

**If the workflows-work skill fails or tests fail:**
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

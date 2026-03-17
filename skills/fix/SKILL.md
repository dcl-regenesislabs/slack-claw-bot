---
name: fix
description: Implement features or fix bugs by creating pull requests. Clones repos, creates feature branches, implements changes, runs build and tests, and opens PRs via gh CLI. Use when someone says "fix", "implement", "create a PR", or asks to resolve a GitHub issue or Sentry error with a code change.
---

# Fix — Implement Changes via Pull Request

## Trigger

Activate when the user:
- Starts the message with `fix` (e.g. "fix issue #42", "fix the login bug")
- Asks to implement a feature or change
- Asks to create a PR for something
- Follows up from the `sentry` skill and confirms they want to fix an issue
- Follows up from the `plan` skill and confirms they want to implement a plan

---

## Two Scenarios

### Scenario A — Plan + Create PR (feature or change, no specific issue)

1. Run the `plan` skill triage workflow:
   - Read `@dcl/jarvis` manifests to identify repos and components involved
   - Clone candidate repos, inspect source code
   - Produce the 9-section implementation plan

2. Present the plan in Slack and ask:
   > "Should I go ahead and implement this? Reply `yes` to proceed."
   **STOP and wait for confirmation.**

3. After confirmation → proceed to Implementation Phase below.

### Scenario B — Fix a specific issue (GitHub issue or Sentry error)

1. **GitHub issue:**
   ```bash
   gh issue view {number} -R {owner}/{repo} --json title,body,comments,labels
   ```

2. **Sentry issue:** use the data already gathered from the sentry skill (stack trace, culprit, root cause hypothesis).

3. Analyze which repos are involved.

4. **Single repo** → proceed directly to Implementation Phase (no confirmation needed).

5. **Multiple repos** → present a brief summary of planned changes per repo, then ask:
   > "This touches {N} repos. Should I proceed with all of them?"
   Wait for confirmation before implementing.

---

## Implementation Phase

### 1. Clone or update the repo
```bash
if [ -d tmp/{repo} ]; then
  git -C tmp/{repo} checkout main && git -C tmp/{repo} pull --ff-only
else
  gh repo clone {owner}/{repo} tmp/{repo}
fi
```

Only clone repos under the `decentraland` or `dcl-regenesislabs` org.

### 2. Create a feature branch
```bash
cd tmp/{repo}
BRANCH="agent/{short-kebab-description}-$(date +%s)"
git checkout -b "$BRANCH"
```

### 3. Implement changes
Use `read`, `edit`, and `write` tools to modify files in `tmp/{repo}/`.

Reference the existing code patterns in the repo — don't reinvent what's already there.

### 4. Build and test (mandatory before pushing)
```bash
cd tmp/{repo}

# Detect build system
if [ -f package.json ]; then
  npm ci && npm run build && npm test
elif [ -f yarn.lock ]; then
  yarn install --frozen-lockfile && yarn build && yarn test
elif [ -f Makefile ]; then
  make build && make test
fi
```

If build or tests fail:
- Analyze the failure and fix the issue
- Re-run build + tests
- If still failing after 2 attempts, **stop and report the failure** to the user — do not push broken code

### 5. Commit
```bash
cd tmp/{repo}
git add -A
git commit -m "fix: {concise description}

Requested by {name} via Slack"
```

### 6. Push and create PR
```bash
git push -u origin "$BRANCH"

gh pr create \
  --repo {owner}/{repo} \
  --title "{concise title under 70 chars}" \
  --body "$(cat <<'EOF'
## Summary
{1-3 bullet points describing what changed}

## Root Cause
{brief explanation of why the bug existed or why this change is needed}

## Changes
{bullet list of key files/functions modified}

## Testing
{what was built and tested}

---
Requested by {name} via Slack
EOF
)"
```

### 7. Report back to Slack
Post the PR URL(s) with a brief summary:
```
✅ PR created: <https://github.com/{owner}/{repo}/pull/{number}|{title}>
```

---

## Multi-repo PRs

When changes span multiple repos:
- Implement and create a separate PR for each repo
- Note cross-repo dependencies in each PR body (e.g. "Depends on decentraland/other-repo#42")
- List all PR URLs in the final Slack message

---

## Safety Rules

- **Never** push directly to `main` or `master`
- **Never** force push (`--force`, `-f`)
- Branch name must always start with `agent/`
- Build + tests must pass before pushing — no exceptions
- Only work in repos under `decentraland` or `dcl-regenesislabs` orgs
- If `git push` fails due to permissions, report the error and the branch name so the user can push manually

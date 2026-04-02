---
name: workflows-work
description: Execute work plans efficiently while maintaining quality and finishing features. Takes a plan file path, reads it, implements all changes task by task, runs tests after each change, creates incremental commits, and verifies quality. Use after workflows-plan creates a plan document.
argument-hint: "[plan file path, e.g. docs/plans/2026-03-26-fix-something-plan.md]"
---

# Work Plan Execution

Execute a work plan systematically: understand requirements, follow existing patterns, test continuously, commit incrementally, and ship complete features.

## Input

The argument should be a path to a plan file (created by `workflows-plan`), e.g.:
```
docs/plans/2026-03-26-fix-something-plan.md
```

**If no argument is provided:**

```bash
ls -t docs/plans/*-plan.md 2>/dev/null | head -5
```

Use the most recent plan. If none exist, stop and say: "No plan file found. Run the plan workflow first."

---

## Phase 1: Understand the Plan

1. **Read the plan completely**

   ```bash
   cat <plan-file-path>
   ```

2. **Read ALL referenced files** — The plan lists relevant files with paths and line numbers. Read every one to understand the current state before making any changes.

3. **Extract the task list** — The `Proposed Changes` section contains checkboxes. These are your tasks. Execute them in order.

4. **Note build/test commands** — The plan should list the repo's exact build, test, lint, and typecheck commands. Use these throughout.

---

## Phase 2: Execute

For each task in the plan's `Proposed Changes`:

### 2a. Read before writing

- Read the file(s) that need to change
- Search the codebase for similar patterns: `grep -r "similar_thing" --include="*.ts" -l`
- Follow existing conventions exactly — naming, structure, style

### 2b. Make the change

- Implement following existing patterns found in 2a
- Match naming conventions exactly
- Reuse existing components where possible

### 2c. Test immediately

Run the repo's test command after EACH change, not at the end:

```bash
# Use the commands from the plan's "Build & Test Commands" section
# Common examples:
# npm test
# npm run build
# cargo test
# pytest
```

**If tests fail:** fix immediately before moving to the next task. Do not accumulate broken state.

### 2d. Mark done in the plan

Edit the plan file to check off the completed task:

Change `- [ ] Change 1: description` to `- [x] Change 1: description`

### 2e. Evaluate for incremental commit

| Commit when... | Don't commit when... |
|----------------|---------------------|
| Logical unit complete (model, service, component) | Small part of a larger unit |
| Tests pass + meaningful progress | Tests failing |
| About to switch contexts (backend → frontend) | Purely scaffolding with no behavior |
| About to attempt risky/uncertain changes | Would need a "WIP" commit message |

**Heuristic:** "Can I write a commit message that describes a complete, valuable change? If yes, commit."

```bash
# Stage only files related to this logical unit (NOT git add .)
git add <specific-files>
git commit -m "feat(scope): description of this unit"
```

### Repeat 2a-2e for each task.

---

## Phase 3: Quality Check

After ALL tasks are complete:

1. **Run the full CI suite** — use the commands from the plan:

   ```bash
   # Examples (use the repo's actual commands):
   npm run build
   npm test
   npm run lint
   npm run typecheck
   ```

2. **Verify all plan items checked off:**

   ```bash
   grep -c '\- \[ \]' <plan-file-path>
   ```

   If any remain unchecked, go back and complete them.

3. **Review changes:**

   ```bash
   git diff --stat
   git log --oneline origin/HEAD..HEAD
   ```

---

## Phase 4: Final Commit

If there are uncommitted changes after the quality check:

```bash
git add <changed-files>
git status
git diff --staged

git commit -m "$(cat <<'EOF'
feat(scope): description of what and why

Brief explanation if needed.
EOF
)"
```

---

## Phase 5: Report

Output a summary:
- What was implemented
- Tests run and their results
- Commits created
- Any follow-up work needed

If running autonomously (e.g., from the `fix` skill), report completion and proceed to the next step — do not wait for user input.

---

## Key Principles

### Start Fast
- Read the plan, understand it, execute it
- Don't overthink — follow the plan and existing patterns

### The Plan is Your Guide
- The plan references files and patterns for a reason — read them
- Don't reinvent — match what already exists

### Test Continuously
- Run tests after EACH change, not at the end
- Fix failures immediately — don't accumulate broken state

### Follow Existing Patterns
- Match naming conventions exactly
- Reuse existing components where possible
- Follow CLAUDE.md/AGENTS.md conventions if they exist
- When in doubt, grep for similar implementations

### Commit Incrementally
- Small, focused commits with meaningful messages
- Stage specific files, not `git add .`
- Each commit should pass tests

### Ship Complete Features
- All plan checkboxes must be checked
- All tests must pass
- Don't leave features 80% done

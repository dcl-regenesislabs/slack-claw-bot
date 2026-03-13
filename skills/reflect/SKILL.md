---
name: reflect
description: Review recent learnings and open PRs to improve skill files
---

# Reflect

Use this skill when asked to review recent learnings or improve your own skills.

## Review recent learnings

1. Use the `memory-search` skill to find recent patterns and learnings, or read the last 7 days of daily logs directly from the memory base directory provided in context:
   ```bash
   ls -t <memory_base_dir>/daily/ | head -7
   ```

2. Read each file and identify:
   - Recurring patterns or mistakes
   - Knowledge that should be promoted to MEMORY.md
   - Outdated entries in MEMORY.md that should be removed

3. Update MEMORY.md if needed — consolidate, don't just append.

## Self-improvement via PR

When asked to improve your skills, or when you notice recurring patterns that a skill update would fix:

1. **Search recent daily logs** for patterns using the `memory-search` skill — what keeps coming up? What mistakes repeat?
2. **Clone this bot's repo** and create a branch using the `github` skill's PR workflow
3. **Edit skill files** in `skills/` or `prompts/system.md` — add missing context, fix incorrect guidance
4. **Run build and tests** before committing
5. **Open a PR** using the `github` skill — keep changes small and focused, one theme per PR
6. **Report the PR URL** back to the Slack thread

## What you can change

- `skills/**/*.md` — skill content and instructions
- `prompts/system.md` — system prompt tweaks
- `MEMORY.md` — if committing shared knowledge to the repo makes sense

## What you must NOT change

- `src/**` — no code changes, only markdown
- Security rules — never weaken guardrails, injection protection, or auth checks
- Never merge your own PRs — a human must review and merge

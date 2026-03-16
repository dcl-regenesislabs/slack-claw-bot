---
name: create-skill
description: Create a new runtime skill that persists across deploys. Use when the user asks to add a new capability, automate a workflow, or teach the bot a new behavior. Also use when the user says "learn how to..." or "remember how to..." for repeatable procedures.
---

# Create a Runtime Skill

Create new skills in the memory repo so they persist across deploys and are available to all sessions.

## Where to create

Write skills to `{memory_base_dir}/skills/<skill-name>/SKILL.md`. The memory base directory is shown in the memory context injected into your system prompt (look for "Memory base directory:").

## Skill file structure

```
skill-name/
  SKILL.md          # Required — frontmatter + instructions
  references/       # Optional — supporting docs loaded into context
    api-docs.md
    examples.md
```

## SKILL.md format

```markdown
---
name: skill-name
description: When to trigger + what it does. Be specific about activation contexts.
---

# Skill Title

Instructions in markdown. Use imperative form.
```

### Frontmatter fields

- `name` — kebab-case identifier (must match the directory name)
- `description` — Explain both *when* the skill should activate and *what* it does. Be slightly "pushy" — include contexts where the skill should fire even if not explicitly named, to avoid undertriggering. Example: "Summarize PR changes and check for common issues. Use when a user shares a GitHub PR link, asks for a code review, or mentions reviewing changes."

### Writing the instructions

- Use imperative form ("Fetch the PR", not "You should fetch the PR")
- Explain *why* things matter rather than using heavy-handed MUST/NEVER
- Include examples with realistic inputs and outputs
- Generalize — the skill will be used many times, not just for one case
- Keep under 500 lines — use `references/` for lengthy docs
- Reference only tools the agent already has: bash, read, write, edit, `gh`, `curl`, `npx`, `git`

## What skills can do

Skills teach the agent to use its existing tools in specific patterns:

- Bash commands and CLI workflows (`gh`, `curl`, `npx`, `git`)
- API calls via `curl` or CLI tools
- Analysis workflows with structured response templates
- File operations in allowed directories (memory repo, `/tmp/`)
- Multi-step procedures combining existing tools

## What skills cannot do

- Modify project source files (`src/`, `test/`, `package.json`, etc.) — writes are blocked by the tool guard
- Require new code to be added to the bot
- Reference internal bot functions not exposed to the agent (e.g., `WebClient` methods)
- Install new dependencies

## After creation

1. Push the skill to the memory repo using the `push-memory` skill
2. The skill becomes available on the next conversation (skills from the memory repo are loaded at session creation)
3. Test by asking the bot to use it in a Slack thread — no automated eval, just manual verification

## Example

A skill that checks deployment status:

```markdown
---
name: check-deploy
description: Check the deployment status of a service. Use when someone asks about deploys, rollouts, or whether a change is live.
---

# Check Deploy Status

Check the current deployment status of a service using the GitHub API.

## Steps

1. Identify the repo from context or ask the user
2. Fetch the latest deployment:
   ```bash
   gh api repos/{owner}/{repo}/deployments --jq '.[0]'
   ```
3. Get the deployment status:
   ```bash
   gh api repos/{owner}/{repo}/deployments/{id}/statuses --jq '.[0]'
   ```
4. Report: environment, status, timestamp, and the commit that was deployed
```

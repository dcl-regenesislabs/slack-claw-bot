---
name: workflows-plan
description: Research-driven planning workflow that uses specialized sub-agents to investigate a codebase before creating an implementation plan. Delegates research to repo-research-analyst, learnings-researcher, best-practices-researcher, framework-docs-researcher, and spec-flow-analyzer agents running in parallel. Creates a plan document in docs/plans/. Use when you need to plan before implementing.
argument-hint: "[feature description, bug report, or improvement idea]"
---

# Research-Driven Planning Workflow

**Note: The current year is 2026.**

Create a thorough, research-backed implementation plan by delegating investigation to specialized sub-agents before writing the plan.

## Input

The feature description or bug report is passed as an argument.

**If empty, stop and say:** "What would you like to plan? Describe the feature, bug fix, or improvement."

Do not proceed without a clear description.

---

## CRITICAL: cwd must be the target repo

Before calling the `subagent` tool, determine the current working directory using `pwd`. The sub-agents must run in the repo being fixed, NOT in the agent-server repo. Always pass the result of `pwd` as the `cwd` parameter.

---

## Workflow

### Step 1: Local Research (PARALLEL)

Use the `subagent` tool to run two research agents **in parallel**. Pass the current working directory and the feature description:

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "repo-research-analyst",
      task: "Research this repository for: <feature description>. Find architecture patterns, conventions (CLAUDE.md, README, CONTRIBUTING), project structure, build/test commands, existing implementations similar to this feature, and GitHub issue/PR templates."
    },
    {
      agent: "learnings-researcher",
      task: "Search docs/solutions/ for past learnings related to: <feature description>. Use grep to pre-filter by keywords before reading files. Check critical-patterns.md. Return relevant gotchas, patterns, and prevention guidance."
    }
  ]
})
```

**Read the results carefully.** Extract and note:
- Build/test/lint commands
- Project structure and conventions
- Existing patterns similar to what needs to be built/fixed
- Key files that will need changes
- Past learnings and gotchas to avoid

### Step 2: Research Decision

Based on findings from Step 1, decide if external research is needed.

**Always research externally when:**
- Security, payments, external APIs, data privacy topics
- Feature involves unfamiliar technology or framework
- No existing patterns found in the codebase

**Skip external research when:**
- Codebase has clear patterns for this type of work
- CLAUDE.md has explicit guidance
- The fix is straightforward

Announce the decision briefly:
- "Codebase has solid patterns for this. Skipping external research."
- "This involves external APIs — researching best practices first."

### Step 3: External Research (CONDITIONAL — only if Step 2 says yes)

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "best-practices-researcher",
      task: "Research best practices for: <feature description>. Check relevant skills first, then search for current industry standards, official documentation, and common pitfalls. Check for API deprecations if external services are involved."
    },
    {
      agent: "framework-docs-researcher",
      task: "Gather documentation for the frameworks/libraries involved in: <feature description>. Check installed versions from package.json/Gemfile.lock. Find version-specific constraints, deprecations, and implementation patterns."
    }
  ]
})
```

### Step 4: SpecFlow Analysis

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "spec-flow-analyzer",
      task: "Analyze the following feature specification for completeness. Map all user flows, identify edge cases, find gaps in requirements, and formulate critical questions.\n\nFeature: <feature description>\n\nResearch findings: <summary of findings from Steps 1-3>"
    }
  ]
})
```

### Step 5: Consolidate Research

Before writing the plan, consolidate ALL findings from the sub-agents:

- Document relevant file paths with line numbers (e.g., `src/services/auth.ts:42`)
- List institutional learnings and gotchas to avoid
- Note external best practices and documentation URLs
- List user flows identified and any gaps found
- Capture build/test/lint commands from repo context

### Step 6: Write the Plan

Create the plan file at `docs/plans/YYYY-MM-DD-<type>-<descriptive-name>-plan.md`.

```bash
mkdir -p docs/plans
```

**Title format:** `feat: Add user authentication` or `fix: Cart total calculation`
**Filename format:** `2026-03-26-fix-cart-total-calculation-plan.md`

**Plan template:**

```markdown
---
title: [Issue Title]
type: [feat|fix|refactor]
date: YYYY-MM-DD
---

# [Issue Title]

[Brief problem/feature description]

## Root Cause Analysis

[What's causing the issue / what needs to change and why — informed by repo research]

## Relevant Files

- `path/to/file.ts:line` — description of what this file does
- `path/to/test.ts` — existing test coverage

[From repo-research-analyst findings]

## Institutional Learnings

[From learnings-researcher — gotchas, past solutions, patterns to follow/avoid]

## User Flows & Edge Cases

[From spec-flow-analyzer — key flows, identified gaps, critical questions]

## Proposed Changes

- [ ] Change 1: description
- [ ] Change 2: description
- [ ] Change 3: description

## Acceptance Criteria

- [ ] Core requirement 1
- [ ] Core requirement 2
- [ ] Tests pass
- [ ] Lint/typecheck pass

## Build & Test Commands

[From repo context — exact commands to run]

## References

- Related issue: [URL if applicable]
- Similar implementation: [file path if found during research]
- External docs: [URLs from best-practices/framework-docs research]
```

For complex features, add:
- Technical Considerations (architecture impacts, performance, security)
- Implementation Phases (for multi-step work)
- Alternative Approaches Considered

### Step 7: Validate

After writing the plan:
- Verify referenced file paths exist (use `ls` or `cat`)
- Ensure acceptance criteria are measurable
- Confirm proposed changes are specific enough to implement

### Step 8: Report

Output the plan file path. If running autonomously (e.g., from the `fix` skill), report the path and proceed — do not wait for user input.

---

## Key Principles

- **Always use subagent** — delegate research to specialized agents, don't do it yourself
- **Always pass cwd** — sub-agents must run in the target repo
- **Research first, plan second** — never plan without understanding the codebase
- **Be specific** — reference actual file paths, function names, and line numbers
- **NEVER write code** — only research and write the plan document

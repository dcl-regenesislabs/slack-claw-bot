---
name: workflows-compound
description: Document a recently solved problem to compound your team's knowledge. Uses parallel sub-agents to analyze context, extract the solution, find related docs, develop prevention strategies, and classify the category. Produces a single structured file in docs/solutions/. Use after fixing a bug or solving a non-trivial problem.
argument-hint: "[optional: brief context about the fix]"
---

# Compound Knowledge Documentation

Coordinate parallel sub-agents to document a recently solved problem, creating structured documentation in `docs/solutions/` for future reference.

**Why "compound"?** Each documented solution compounds your team's knowledge. The first time you solve a problem takes research. Document it, and the next occurrence takes minutes.

## Input

Optional brief context about the fix. If empty, analyze recent git history and conversation context to identify what was just solved.

## CRITICAL: cwd must be the target repo

Run `pwd` before calling the subagent tool. Sub-agents must run in the repo where the fix was made.

---

## Preconditions

Before proceeding, verify:
- A problem was actually solved (not in-progress)
- The solution has been verified working
- It's non-trivial (not a simple typo)

If unclear, ask: "What problem did you just solve? Give me a brief description."

---

## Workflow

### Phase 1: Parallel Research

Launch 5 research tasks in parallel. Each returns TEXT DATA — they must NOT write any files.

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "repo-research-analyst",
      task: "CONTEXT ANALYSIS: Analyze the recent changes in this repo to document a solved problem.\n\nContext hint: <argument if provided>\n\nDo the following:\n1. Check recent git commits: git log --oneline -20\n2. Check recent diffs: git diff HEAD~3..HEAD --stat\n3. Identify the problem type, component, and symptoms\n4. Return a YAML frontmatter skeleton with fields: title, date, module, problem_type, component, symptoms, root_cause, tags, severity\n\nReturn ONLY text data. Do NOT write any files."
    },
    {
      agent: "repo-research-analyst",
      task: "SOLUTION EXTRACTION: Analyze the recent fix in this repo.\n\nContext hint: <argument if provided>\n\n1. Read the recent commits and diffs\n2. Identify all investigation steps that were tried\n3. Identify the root cause\n4. Extract the working solution with code examples\n5. Return a structured solution content block with sections: Root Cause, Investigation Steps, Solution, Code Examples\n\nReturn ONLY text data. Do NOT write any files."
    },
    {
      agent: "learnings-researcher",
      task: "RELATED DOCS: Search docs/solutions/ for documentation related to the recent fix.\n\nContext hint: <argument if provided>\n\n1. Search for related solutions by keywords\n2. Find cross-references and links\n3. Search GitHub issues for related problems: gh issue list --search '<keywords>' --limit 5\n4. Return: list of related docs, links, and relationships\n\nReturn ONLY text data. Do NOT write any files."
    },
    {
      agent: "best-practices-researcher",
      task: "PREVENTION STRATEGY: Develop prevention strategies for the recently solved problem.\n\nContext hint: <argument if provided>\n\n1. Analyze what caused the problem\n2. Develop strategies to prevent recurrence\n3. Suggest tests or checks that would catch this earlier\n4. Create best practices guidance\n5. Return: prevention strategies, test cases, best practices\n\nReturn ONLY text data. Do NOT write any files."
    },
    {
      agent: "repo-research-analyst",
      task: "CATEGORY CLASSIFICATION: Determine the correct docs/solutions/ category for this fix.\n\nContext hint: <argument if provided>\n\nCategories:\n- build-errors/\n- test-failures/\n- runtime-errors/\n- performance-issues/\n- database-issues/\n- security-issues/\n- ui-bugs/\n- integration-issues/\n- logic-errors/\n- developer-experience/\n- workflow-issues/\n- best-practices/\n- documentation-gaps/\n\n1. Analyze the recent fix\n2. Determine which category fits best\n3. Suggest a kebab-case filename based on the problem\n4. Return: category, filename, and full path\n\nReturn ONLY text data. Do NOT write any files."
    }
  ]
})
```

### Phase 2: Assembly & Write (SEQUENTIAL — wait for Phase 1)

**ONLY the orchestrator (you) writes the file.** Sub-agents returned text data only.

1. **Collect** all results from Phase 1
2. **Assemble** the complete markdown file:

```markdown
---
title: <from context analyzer>
date: <today YYYY-MM-DD>
module: <from context analyzer>
problem_type: <from context analyzer>
component: <from context analyzer>
symptoms:
  - <symptom 1>
  - <symptom 2>
root_cause: <from context analyzer>
tags:
  - <tag1>
  - <tag2>
severity: <critical|high|medium|low>
---

# <Title>

## Problem

<Exact error messages, observable behavior — from context analyzer>

## Investigation

<Steps tried, what didn't work and why — from solution extractor>

## Root Cause

<Technical explanation — from solution extractor>

## Solution

<Step-by-step fix with code examples — from solution extractor>

## Prevention

<How to avoid in future — from prevention strategist>

## Testing

<Test cases to catch this — from prevention strategist>

## Related

<Links to related docs and issues — from related docs finder>
```

3. **Create** the directory and write the file:

```bash
mkdir -p docs/solutions/<category>/
```

Write the file to `docs/solutions/<category>/<filename>.md`

### Phase 3: Optional Enhancement (CONDITIONAL)

Based on the problem type, optionally run specialized review agents:

| Problem type | Run agent |
|---|---|
| performance_issue | `performance-oracle` |
| security_issue | `security-sentinel` |
| database_issue | `data-integrity-guardian` |
| Any code-heavy issue | `code-simplicity-reviewer` |

```
subagent({
  cwd: "<result of pwd>",
  tasks: [
    {
      agent: "<appropriate reviewer>",
      task: "Review this solution documentation for accuracy and completeness:\n\n<file content>"
    }
  ]
})
```

If the reviewer suggests improvements, update the file.

### Phase 4: Report

```
Documentation complete.

File created: docs/solutions/<category>/<filename>.md

Sub-agent results:
  - Context Analyzer: <summary>
  - Solution Extractor: <summary>
  - Related Docs Finder: <count> related docs found
  - Prevention Strategist: <count> prevention strategies
  - Category Classifier: <category>

This documentation will be searchable for future reference when similar issues occur.
```

---

## Key Principles

- **Phase 1 agents return TEXT only** — they must NOT write files
- **Only ONE file gets written** — by the orchestrator in Phase 2
- **Document while context is fresh** — run immediately after solving a problem
- **Be specific** — include exact error messages, file paths, code examples
- **Knowledge compounds** — each documented solution saves time for the next occurrence

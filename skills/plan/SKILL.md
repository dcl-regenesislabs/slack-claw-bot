---
name: plan
description: Plan backend changes, investigate Decentraland service architecture, trace service dependencies, identify service owners, understand call chains, answer implementation questions (e.g. "how do I add a new profile endpoint?"), and inspect source code when needed. Use when someone asks which services are involved in a feature, who owns a service or flow, how to implement or deploy something in the backend, or needs to understand service relationships.
---

# Decentraland Backend — Service Architecture

This skill provides access to LLM-optimized snapshots of all Decentraland core backend services.

## Files

All files live in `skills/plan/`:

| File | Purpose | ~Tokens |
|------|---------|---------|
| `skills/plan/index.yaml` | **Start here** — one entry per service: layer, owner, calls, called_by | ~600 |
| `skills/plan/services.yaml` | Comprehensive index with metadata (no dep graph) | ~3,500 |
| `skills/plan/services-graph.yaml` | Dependency graph only — on-demand lookup | ~2,500 |
| `skills/plan/service_{name}.yaml` | Per-service: compact header + raw docs (openapi, readme, ai_context) | varies |

## Triage Workflow

When asked to plan a change or identify which services are involved:

1. Read `skills/plan/index.yaml` — identify candidate services (layer, owner, who calls whom)
2. Read the header of `skills/plan/service_{name}.yaml` for each candidate (stop before `# ─── DETAILED DOCS`)
3. Only read below the separator if you need API spec / ai_context / readme details
4. Report: involved services, call chain, owners to notify, submodules to check if source-level investigation is needed

## Ownership Queries

When asked "who owns X?":

1. Read `skills/plan/index.yaml` — find the service and check the `owner` field
2. If `owner: null`, read the service header in `skills/plan/service_{name}.yaml` — the `ai_context` or `readme` sections may name a team or contact
3. Report the owner/team name and the service's GitHub URL (from the `github` field)

## Implementation / Deployment Questions

When asked "how do I implement X?" or "how do I deploy/create Y?":

1. Identify the relevant service(s) from `skills/plan/index.yaml`
2. Read the service header from `skills/plan/service_{name}.yaml`
3. Read `ai_context` — it describes architecture, patterns, and key conventions
4. Read `openapi` if the question involves an API endpoint
5. Read `readme` for deployment steps, configuration, and environment setup
6. If the YAML context is insufficient, **clone the repo and inspect the source** (see below)

When returning code examples in your response, always use code blocks with the appropriate language tag.

## When to Inspect Source Code

Inspect source code when:
- The YAML docs don't fully answer the implementation question
- The user asks about specific code patterns, file structure, or how something works internally
- You need to find an example of how an existing endpoint or feature was implemented

**Do NOT use `git clone` or `gh repo clone`** — use the GitHub API via `gh api` to read files directly without cloning:

```bash
# List directory contents
gh api repos/<owner>/<repo>/contents/<path>

# Read a specific file (decoded from base64)
gh api repos/<owner>/<repo>/contents/<path/to/file.ts> --jq '.content' | base64 -d
```

Start by listing the repo root or `src/` to find relevant files, then read specific files as needed. Return any relevant code snippets in properly formatted code blocks.

## Layer Codes

| Code | Meaning |
|------|---------|
| RT | Realtime (WebSocket, LiveKit) |
| CN | Content (Catalyst, asset pipeline) |
| FS | Feature servers (business logic) |
| LIB | Shared library (no HTTP surface) |
| OTHER | Infra / tooling |

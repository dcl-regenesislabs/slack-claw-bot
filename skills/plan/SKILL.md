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

## Selecting Integration Points

Before proposing which service to modify for any feature, use `index.yaml` fields to classify candidates — do not rely on service names alone.

**Use `role` to find the right service type:**
- Need to enforce access or block users? → look for `role: gateway` or `role: rt-gateway`
- Need to store new domain data? → look for `role: storage` with matching `data_domain`
- Need to issue/validate credentials? → look for `role: auth`
- **Never add enforcement logic to `role: discovery` services** — they provide information only and have no access control mechanisms

**Use `data_domain` to find where data lives:**
- Search `data_domain` lists for the entity type you need (e.g., `bans`, `friendships`, `tokens`)
- If no service owns it yet, add it to the most domain-appropriate `role: storage` service

**Use `called_by` as a risk signal:**
- Services with many callers are shared infrastructure — changes have wide blast radius
- Prefer adding logic to a service with fewer callers when possible

**Checklist before finalising integration points:**
1. What `role` does each candidate service have? Does it match what I need?
2. Which service has the relevant `data_domain` entries?
3. Does the candidate already have auth/enforcement patterns? (check `ai_context` and `openapi`)
4. Is the candidate in the actual request/connection path? (trace `calls`/`called_by` graph)

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


## Implementation Plan Structure

When delivering a backend implementation plan, include:

**1. Architecture Decision**
- Which services to modify/create and why
- Rationale for service selection (with alternatives considered and rejected)
- Clear statement of "extend vs create" justification

**2. Implementation Components** (in order of dependencies)
- Database schema (migrations, tables, indexes)
- Data access layer (DB adapters)
- Domain logic (business components)
- API layer (controllers, handlers, routes)
- Integration points (service-to-service calls)
- Supporting infrastructure (cron jobs, workers, events)

**3. Data Flow Diagrams**
- Use Mermaid sequence diagrams for key user flows
- Show: actors, services, calls, decisions (e.g., "if banned → 403")
- Include at least: primary happy path, primary error path
- Label each step with component/endpoint names

**4. Files to Create/Modify**
- List every file that needs changes
- Group by service/repository
- Distinguish "new files" from "modified files"
- Include test files

**5. Configuration**
- Environment variables (.env.default entries)
- Feature flags
- Service-to-service credentials/URLs

**6. Implementation Order**
- Phase 1: Core storage/API (database, adapters, domain logic)
- Phase 2: Integration (service-to-service calls, events)
- Phase 3: Client/UI (if applicable)
- Each phase should be independently deployable and testable

**7. Dependencies**
- List new npm packages (if any)
- List service-to-service dependencies
- Note existing components to reuse

**8. Testing Strategy**
- Unit tests for domain logic
- Integration tests for API endpoints
- Service integration tests (for cross-service calls)

**9. Deployment Notes**
- Database migrations (run before code deploy)
- Service deployment order
- Rollback plan

## Design Principles (apply to all implementation plans)

**Architecture & Reuse**
- **Default: extend, never create.** Before proposing a new service, identify every existing service that could accommodate this feature, and explain concretely why each one cannot. If an existing service *can* handle it — even imperfectly — extend it.
- A new service is only justified when *both* conditions hold: (1) the domain is genuinely distinct from all existing services, *and* (2) adding this feature would fundamentally distort the existing service's model — not just add new endpoints or tables.
- **Ownership is never a justification for a new service.** All Decentraland services (whether used by users, creators, or internally) are owned and coded by core engineering. Different stakeholders or governance models do not create different service owners.
- When creating a new service: follow the Well-Known Components pattern, add it to `skills/plan/index.yaml` and architecture docs.
- Place code in the correct layer: RT (WebSocket/LiveKit), CN (Catalyst/assets), FS (feature servers), LIB (no HTTP), OTHER (infra). No cross-layer leakage.

**Well-Known Components pattern (mandatory)**
- `AppComponents` interface + `initComponents()` factory — one instance per component, no global singletons. Favor small, focused interfaces; avoid "god" components.
- **Adapters** (`adapters/`): wrap external I/O (DB, HTTP, Redis, queues); isolate protocols from domain logic.
- **Domain logic** (`logic/`): implement business rules via component interfaces only — no HTTP/transport details.
- **Controllers** (`controllers/handlers/`): thin — parse input, call `context.components`, map to HTTP/errors. Never construct components inline.

**API & Error Design**
- Follow existing HTTP patterns (routes, status codes, response envelopes) from similar services.
- Validate all external inputs at the edge using shared schema validators.
- Surface domain errors as typed results; convert to HTTP errors only in controllers.

**Communication**
- Prefer SNS/SQS over direct HTTP for async service-to-service calls. Design event handlers to be idempotent.

**Observability**
- Use `createLogComponent`, `createMetricsComponent`, tracing, and health-check components from shared libs.

**Testing & Documentation**
- Keep business logic side-effect-free; inject I/O via interfaces. Use `test/components.ts` for in-memory mocks.
- Update `README.md` and `docs/ai-agent-context.md` alongside code changes.

**Performance**
- Use existing cache (in-memory/Redis) and DB components. Avoid unbounded in-memory growth; respect rate limits.

**Delivery & Collaboration**
- Ship in small, reversible increments; use feature flags for risky changes. Ensure DB migrations are backward-compatible.
- Before new components or APIs, check existing patterns and confirm with owning teams.

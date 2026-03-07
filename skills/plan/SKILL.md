---
name: plan
description: Plan backend changes, investigate Decentraland service architecture, trace service dependencies, identify service owners, understand call chains, answer implementation questions (e.g. "how do I add a new profile endpoint?"), and inspect source code when needed. Use when someone asks which services are involved in a feature, who owns a service or flow, how to implement or deploy something in the backend, or needs to understand service relationships.
---

# Decentraland Backend — Service Architecture

This skill provides access to LLM-optimized snapshots of all Decentraland core backend services via the `@dcl/jarvis` package.

## CRITICAL: Never answer from general knowledge

Do **NOT** answer based on prior knowledge. The triage workflow below is mandatory for every question.

**Pre-response checklist** (complete all before writing your answer):
- [ ] Read `index.yaml` and `graph.yaml`
- [ ] Read `{name}.yaml` for every candidate
- [ ] Cloned every candidate repo and read `ai-agent-context`, `README.md`, OpenAPI spec, `src/`, and DB schema
- [ ] For implementation plans: confirmed the user explicitly requested a new service, OR identified an existing service to extend

**HARD RULE — never propose a new service unless explicitly asked:**
**NEVER propose creating a new service** unless the user's message explicitly requests it (e.g. "create a new service", "I want a new service for X"). If the user did not explicitly ask for a new service, always extend the most appropriate existing service — even if it is imperfect. Adding endpoints, tables, handlers, or workers to an existing service is always preferred.

**Never send a file path as the response.** Return the full answer in the Slack message. Use `/tmp/` as scratch space only — delete when done, never reference in response.

---

## Step 0 — Ensure latest manifests

```bash
INSTALLED=$(node -e "console.log(require('./node_modules/@dcl/jarvis/package.json').version)" 2>/dev/null || echo "none")
LATEST=$(npm view @dcl/jarvis version 2>/dev/null)
if [ "$INSTALLED" != "$LATEST" ]; then
  echo "Updating @dcl/jarvis from $INSTALLED to $LATEST..."
  npm install @dcl/jarvis@latest --no-save --silent
else
  echo "@dcl/jarvis is up to date ($INSTALLED)"
fi
```

## Manifests

All in `node_modules/@dcl/jarvis/manifests/`:

| File | Purpose |
|------|---------|
| `index.yaml` | One entry per service: name, description, layer, repository, dependencies (~600 tokens) |
| `graph.yaml` | Full dependency graph (~2,500 tokens) |
| `{name}.yaml` | Per-service: team, repository, ai-agent-context URL, owned_entities, responsibilities, invariants, openapi_url, db schema_url, events, adrs |

## Triage Workflow

Applies to **every question** regardless of type.

### Round 1 — Scan manifests

1. Read `index.yaml` — identify candidate services by description, layer, dependencies
2. Read `graph.yaml` — for each candidate, scan **both directions**:
   - **Outbound** (what does this service call?) — already captured in `{name}.yaml` `dependencies`
   - **Inbound** (what services list this candidate in their own `dependencies`?) — find these in `graph.yaml` and add every inbound dependent as a candidate; they may need changes too if you modify this service's API or data model
3. For each candidate, read the **entire** `{name}.yaml`. Add to candidate list if found: `domain.concept_relationships.cross_service`, `events.publishes/consumes`, `dependencies.services`. Note for Round 2: `ai-agent-context` URL, `api.openapi_url`, `db.schema_url`, `adrs`, `service.team`, `domain.owned_entities`.

### Round 2 — Inspect source (mandatory for every candidate)

Clone all candidate repos upfront, browse freely, delete when done:

```bash
# Clone all candidate repos (shallow)
git clone --depth=1 https://github.com/decentraland/<repo> /tmp/<repo>

# Read docs — MANDATORY
cat /tmp/<repo>/README.md
cat /tmp/<repo>/docs/ai-agent-context.md   # path derived from service.ai-agent-context URL
cat /tmp/<repo>/docs/openapi.yaml          # path derived from api.openapi_url; or curl if external URL

# Browse and search source freely
ls /tmp/<repo>/src/
find /tmp/<repo>/src -name "*.ts" | head -50
grep -r "<pattern>" /tmp/<repo>/src/

# DB schema
ls /tmp/<repo>/src/db 2>/dev/null
ls /tmp/<repo>/migrations 2>/dev/null

# If question mentions Explorer / client / Unity / renderer — also clone:
git clone --depth=1 https://github.com/decentraland/unity-explorer /tmp/unity-explorer
find /tmp/unity-explorer/Explorer/Assets/Scripts -name "*.cs" | xargs grep -l "<service-pattern>"

# Never clone decentraland/explorer-website

# Clean up all clones when done
rm -rf /tmp/<repo> /tmp/unity-explorer
```

After reading: add any newly discovered services to the candidate list and re-check `index.yaml` for them.

### Round 3+ — Repeat until stable

Repeat Round 2 for each new candidate. Stop when a full pass adds no new candidates.

### Final report

**How-to question** ("how to X", "how do I X", "how can I deploy X"):
- Services involved and why
- Step-by-step with commands/code snippets from the repos
- Key gotchas, required config, auth considerations

**Implementation plan** (Notion URL with no context, OR "I need to create/implement X", OR "plan: \<feature\>"):
- Verify HARD RULE internally (see CRITICAL section)
- Re-read Design Principles below and apply "extend never create", layer placement, Well-Known Components
- Start with **Repos involved** list, then full 9-section plan (see Implementation Plan Structure below)

## Integration Point Selection

**Use `layer`** to find the right service type:

| Value | Use for |
|-------|---------|
| `real-time` | WebSocket/LiveKit (comms, gatekeeper) |
| `content` | Catalyst, asset pipeline |
| `feature-servers` / `Feature Servers Layer` | Business logic — add most features here |
| `shared-library` / `Shared Libraries` | npm packages, no HTTP surface |
| `entry-points` | User-facing gateways — avoid adding logic here |
| `Other` | Infra / tooling |

**Use `domain.owned_entities`** to find where data lives. If no service owns it yet, add to the most domain-appropriate `feature-servers` service.

Clone repos to `/tmp/` with `--depth=1`. Delete all clones when done.

## Implementation Plan Structure

Always open with:
```
**Repos involved:**
- `decentraland/<repo1>` — <one-line role>
- `decentraland/<repo2>` — <one-line role>
```

Then the 9 sections:

1. **Architecture Decision** — which services to modify/create and why
2. **Implementation Components** — DB schema → adapters → domain logic → API layer → integrations → infra
3. **Data Flow Diagrams** — Mermaid sequence diagrams for happy path + error path, labelled with component/endpoint names
4. **Files to Create/Modify** — grouped by repo, new vs modified, include test files
5. **Configuration** — env vars (.env.default entries), feature flags, service-to-service credentials
6. **Implementation Order** — Phase 1: storage/API · Phase 2: integrations · Phase 3: client (each independently deployable)
7. **Dependencies** — new npm packages, service dependencies, existing components to reuse
8. **Testing Strategy** — unit (domain logic), integration (API endpoints), service integration (cross-service)
9. **Deployment Notes** — migration order, service deploy order, rollback plan

## Design Principles

**Default: extend, never create.** A new service requires both: genuinely distinct domain AND the feature would fundamentally distort an existing model. Adding endpoints/tables alone is not enough.

**Layers:** `real-time` (WebSocket/LiveKit) · `content` (Catalyst/assets) · `feature-servers` (business logic) · `shared-library` (no HTTP) · `Other` (infra). No cross-layer leakage.

**Well-Known Components pattern:**
- `AppComponents` + `initComponents()` — one instance per component, no global singletons
- `adapters/` — wrap external I/O (DB, HTTP, Redis, queues); isolate from domain logic
- `logic/` — business rules via interfaces only; no HTTP/transport details
- `controllers/handlers/` — thin: parse input → call components → map to HTTP errors

**API:** Follow existing patterns (routes, status codes, response envelopes). Validate inputs at the edge. Surface domain errors as typed results; convert to HTTP only in controllers.

**Communication:** Prefer SNS/SQS over direct HTTP for async. Design handlers to be idempotent.

**Observability:** Use `createLogComponent`, `createMetricsComponent`, tracing, health-check from shared libs.

**Testing:** Side-effect-free business logic. Use `test/components.ts` for in-memory mocks. Update `README.md` and `docs/ai-agent-context.md` alongside code changes.

**Delivery:** Small reversible increments; feature flags for risky changes; backward-compatible DB migrations.

---
name: plan
description: Plan full-stack or backend features end-to-end across Decentraland backend services and frontend dApps. Investigate service architecture, trace dependencies, identify service owners, understand call chains, answer implementation questions, and produce implementation plans covering both backend and frontend. Use when someone asks which services are involved in a feature, who owns a service or flow, how to implement or deploy something, needs to understand service relationships, or wants to plan a frontend feature or dApp.
---

# Decentraland — Full-Stack Planning

This skill provides access to LLM-optimized snapshots of all Decentraland backend and frontend services via the `@dcl/jarvis` package.

## CRITICAL: Never answer from general knowledge — follow rounds IN ORDER

Do **NOT** answer based on prior knowledge. The triage workflow below is mandatory for every question.

**You MUST complete Rounds 1, 2, and 3 BEFORE starting Round 4.** Round 4 (sub-agents) depends on the repos being cloned and the candidate list being stable. Do NOT skip ahead to sub-agents.

**Pre-response checklist** (complete all IN ORDER before writing your answer):
- [ ] **Round 1**: Read `index.yaml` and `graph.yaml` — identify candidate services
- [ ] **Round 2**: Clone every candidate repo and read `ai-agent-context`, `README.md`, OpenAPI spec, `src/`, and DB schema
- [ ] **Round 3**: Repeat until no new candidates are found
- [ ] **Round 4**: ONLY AFTER Rounds 1-3 are complete — run compound sub-agents on the cloned repos
- [ ] For implementation plans: confirmed whether an existing service/dApp covers the domain, or justified why a new one is needed

**HARD RULE — extend existing before creating new:**
Always extend the most appropriate existing service or frontend app before proposing a new one. If after triage you believe a new service or dApp is genuinely justified (domain is completely different, or work is a migration from a deprecated stack), **state the reasoning clearly and ask for confirmation before proceeding**. For frontend specifically, follow the Frontend Project Selection decision tree below.

**Never send a file path as the response.** Return the full answer in the Slack message. Use `tmp/` as scratch space — delete any temporary files you create (e.g. drafted plans, notes), but never delete cloned repos.

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

---

## Triage Workflow

Applies to **every question** regardless of type.

### Round 1 — Scan manifests

1. Read `index.yaml` — identify candidate services by description, layer, dependencies. Frontend apps may appear under various layer values — scan by description and repository name as well, not layer alone.
2. Read `graph.yaml` — for each candidate, scan **both directions**:
   - **Outbound** (what does this service call?) — captured in `{name}.yaml` `dependencies`
   - **Inbound** (what services list this candidate in their own `dependencies`?) — find in `graph.yaml` and add every inbound dependent as a candidate
3. For each candidate, read the **entire** `{name}.yaml`. Add to candidate list if found: `domain.concept_relationships.cross_service`, `events.publishes/consumes`, `dependencies.services`. Note for Round 2: `ai-agent-context` URL, `api.openapi_url`, `db.schema_url`, `adrs`, `service.team`, `domain.owned_entities`.

### Round 2 — Inspect source (mandatory for every candidate)

Clone all candidate repos upfront, browse freely. Only clone repos under the `decentraland` or `dcl-regenesislabs` org. Repos are kept in `tmp/` — never delete them. Clone with `--depth=1`; if already present, `git pull` instead:

```bash
# Clone or update a repo (shallow) — only decentraland org
if [ -d tmp/<repo> ]; then
  git -C tmp/<repo> pull --ff-only
else
  git clone --depth=1 https://github.com/decentraland/<repo> tmp/<repo>
fi

# Read docs — MANDATORY
cat tmp/<repo>/README.md
cat tmp/<repo>/docs/ai-agent-context.md   # path derived from service.ai-agent-context URL
cat tmp/<repo>/docs/openapi.yaml          # path derived from api.openapi_url; or curl if external URL

# Browse and search source freely
ls tmp/<repo>/src/
find tmp/<repo>/src -name "*.ts" | head -50
grep -r "<pattern>" tmp/<repo>/src/

# DB schema
ls tmp/<repo>/src/db 2>/dev/null
ls tmp/<repo>/migrations 2>/dev/null

# If question mentions Explorer / client / Unity / renderer — also clone/update:
if [ -d tmp/unity-explorer ]; then
  git -C tmp/unity-explorer pull --ff-only
else
  git clone --depth=1 https://github.com/decentraland/unity-explorer tmp/unity-explorer
fi
find tmp/unity-explorer/Explorer/Assets/Scripts -name "*.cs" | xargs grep -l "<service-pattern>"

# Never clone decentraland/explorer-website
```

After reading: add any newly discovered services to the candidate list and re-check `index.yaml` for them.

### Round 3+ — Repeat until stable

Repeat Round 2 for each new candidate. Stop when a full pass adds no new candidates.

### Round 4 — Deep research with compound sub-agents (REQUIRES Rounds 1-3 complete)

**PREREQUISITE**: You must have already completed Rounds 1-3 before this step. Candidate repos must be cloned in `tmp/`. If you haven't read `index.yaml`, `graph.yaml`, cloned repos, and read their docs — go back and do that first.

Use the `subagent` tool to run targeted research on each candidate repo. Pass the repo path as `cwd`.

#### 4a. Local research (run in parallel for each candidate repo)

```
subagent({
  cwd: "tmp/<repo>",
  tasks: [
    {
      agent: "repo-research-analyst",
      task: "Scope: architecture, patterns. Research this repository for implementing <feature>. Find architecture patterns, conventions, existing implementations similar to this feature, build/test commands, and key files that will need changes."
    },
    {
      agent: "learnings-researcher",
      task: "Search docs/solutions/ for past learnings related to: <feature>. Return relevant gotchas, patterns, and prevention guidance."
    }
  ]
})
```

#### 4b. External research (conditional)

Run external research sub-agents only when:
- The feature involves security, payments, external APIs, privacy, or migrations
- The codebase lacks relevant local patterns (fewer than 3 direct examples)
- The technology layer is absent or thin in the candidate repos

Skip when the codebase already shows strong local patterns and the approach is clear.

```
subagent({
  cwd: "tmp/<repo>",
  tasks: [
    {
      agent: "best-practices-researcher",
      task: "Research best practices for: <feature>. Check for current industry standards, official documentation, and common pitfalls."
    },
    {
      agent: "framework-docs-researcher",
      task: "Gather documentation for the frameworks/libraries involved in: <feature>. Find version-specific constraints, deprecations, and implementation patterns."
    }
  ]
})
```

#### 4c. Flow analysis (for non-trivial plans)

For features that involve user flows, state transitions, or cross-service handoffs:

```
subagent({
  cwd: "tmp/<repo>",
  tasks: [
    {
      agent: "spec-flow-analyzer",
      task: "Analyze this feature for completeness: <feature>. Map all user flows, identify edge cases, find gaps in requirements, and formulate critical questions. Research findings: <summary of 4a/4b results>"
    }
  ]
})
```

#### 4d. Consolidate research

Before writing the final report, consolidate ALL findings from sub-agents and jarvis triage:
- Relevant file paths from repo research
- Institutional learnings and gotchas
- External best practices (if gathered)
- Edge cases and flow gaps (if analyzed)
- Constraints that should shape the plan

Incorporate these findings into the Implementation Plan sections below.

### Round 5 — Confidence check and plan strengthening

After writing the initial plan (Final Report below), evaluate whether any sections need strengthening. Score each plan section for confidence gaps:

For each section, check:
- **Architecture Decision**: Are decisions stated without rationale? Are tradeoffs unexplored?
- **Implementation Components**: Are file paths missing? Is dependency order unclear?
- **Data Flow Diagrams**: Are error paths missing? Are cross-service interactions incomplete?
- **Testing Strategy**: Are edge cases and error paths covered? Are integration scenarios included?
- **Deployment Notes**: Are rollout risks addressed? Is rollback plan concrete?

If 2+ sections have gaps, run targeted sub-agents to strengthen them:

| Weak section | Agent to run |
|-------------|-------------|
| Architecture Decision | `architecture-strategist` |
| Implementation Components | `pattern-recognition-specialist` |
| Data Flow / cross-service | `spec-flow-analyzer` |
| Testing Strategy | `spec-flow-analyzer` |
| Security concerns | `security-sentinel` |
| Data migrations | `data-integrity-guardian` |
| Deployment / rollout | `deployment-verification-agent` |
| Performance concerns | `performance-oracle` |

Run only the agents needed (max 3-4 total). Update the plan with their findings — strengthen rationale, add missing edge cases, tighten verification — but do not rewrite the entire plan.

### Final report

**How-to question** ("how to X", "how do I X", "how can I deploy X"):
- Services/apps involved and why
- Step-by-step with commands/code snippets from the repos
- Key gotchas, required config, auth considerations

**Implementation plan** (Notion URL with no context, OR "I need to create/implement X", OR "plan: \<feature\>"):
- Apply HARD RULE internally — confirm extension vs. new creation
- Re-read Design Principles and Frontend Project Selection; apply "extend never create", layer placement, tech stack standards
- Start with **Repos involved** list, then full 9-section plan (see Implementation Plan Structure below)

---

## Frontend Project Selection

When a feature has a frontend component, follow this decision tree **before recommending any work**:

1. **Does an existing dApp already cover this domain?** Search `index.yaml` by description and repository name (layer values for frontend apps may vary). Always prefer extending an existing app over creating a new one.
2. **Is it an internal tool for Decentraland Foundation members** (e.g. moderation, support, ops tooling)? → It belongs in the internal tools site, accessible only to foundation members. Do not create a new public-facing dApp for this.
3. **Is the request a content/marketing site with live editorial updates?** → It belongs in a Contentful-backed site (see blog-site pattern). Marketing teams must be able to edit content without deployments.
4. **Is it a Gatsby-based site?** → Gatsby is internally deprecated. Gatsby sites are in maintenance mode — small fixes and minor changes are acceptable, but prefer moving the affected pages to a non-Gatsby site when the domain allows it. For larger features, plan them in the replacement site if one exists or flag the migration need. **Never create new sites using Gatsby.**
5. **Only if no existing app fits** AND one of the following is true → use `dapps-template` as the starting point, state the reasoning, and ask for confirmation:
   - The feature domain is completely different from all existing dApps (not a natural extension of any of them)
   - The work is a site migration away from a deprecated tech stack (e.g. replacing a Gatsby site with a modern Vite app)

**Reference implementations:**
- **`blog-site`** — canonical pattern for Vite + ui2 + Contentful + TanStack React Query + Redux Toolkit. Use as architectural reference for any content-heavy or authenticated dApp.
- **`landing-site`** — modern landing page pattern (Vite + ui2). Use for marketing pages that don't need live editorial control.
- **`dapps-template`** — minimal Vite + ui2 starter. Use only when creating a brand-new dApp with explicit justification.
- **`landing`** — DEPRECATED (Gatsby). Do not add features here.

---

## Frontend Tech Stack Standards

### Required (all new frontend work)

| Concern | Standard |
|---------|----------|
| Build tool | **Vite** |
| React | 18.x |
| UI components | **decentraland-ui2** (MUI-based) |
| Styling | **styled-components — object syntax only** (see UI Component Standards) |
| Routing | **react-router-dom** v7 |
| State management | **Redux Toolkit** (slices + RTK Query) — only when state complexity justifies it |
| Data fetching | **TanStack React Query** |
| CMS / live content | **Contentful SDK** (not gatsby-source-contentful) |
| Auth | `@dcl/single-sign-on-client` |
| Web3 | `wagmi` + `viem` + `@dcl/core-web3` |
| Testing | **Jest** + **ts-jest** + **React Testing Library**; Storybook for component stories |
| TypeScript | Required. Strict mode. |
| Node | 20.x, npm 10.x |
| Linting | `@dcl/eslint-config@3.x` |

### Deprecated — never use in new or modified code

| Pattern | Replace with |
|---------|-------------|
| **Gatsby** | Vite |
| **Redux Saga** | Redux Toolkit (RTK Query or createAsyncThunk) |
| **decentraland-ui (v1)** | decentraland-ui2 |
| Template literal styled-components (`` styled.div`...` ``) | Object syntax: `styled.div({ ... })` |
| Inline styles (`style={{ ... }}`) | styled-components with theme values |
| Arbitrary hex colors or px values | `theme.palette.*`, `dclColors.*`, `theme.spacing(n)` |
| `gatsby-source-contentful` | `contentful` SDK + React Query |
| `decentraland-gatsby` utilities | Direct equivalents in the new stack |

---

## UI Component Standards

### decentraland-ui2 — always the source of truth

- Every UI component must come from **decentraland-ui2**. Never import from `decentraland-ui` (v1) for new work.
- If a component exists only in ui1 and is needed: **migrate it to ui2 first** (following the ui2 component structure below), then use the ui2 version. Do not skip the migration.
- All components use the **MUI theme**. Never override with arbitrary values.

### Component structure (ui2 pattern)

```
ComponentName/
├── ComponentName.tsx         # Component implementation (React.memo when appropriate)
├── ComponentName.types.ts    # TypeScript interfaces
├── ComponentName.styles.ts   # styled-components — OBJECT SYNTAX ONLY
├── ComponentName.stories.tsx # Storybook stories (required)
├── ComponentName.test.tsx    # Jest + React Testing Library tests (required)
└── index.ts                  # Re-export
```

### Styling rules (strict)

```typescript
// CORRECT — object syntax, theme values only
const StyledButton = styled(Button)((props) => ({
  backgroundColor: props.theme.palette.primary.main,
  padding: props.theme.spacing(2),
  [props.theme.breakpoints.up('md')]: {
    fontSize: props.theme.typography.body1.fontSize,
  },
}));

// WRONG — template literal
const StyledButton = styled(Button)`
  background-color: #ff2d55;
  padding: 16px;
`;

// WRONG — arbitrary values
const StyledButton = styled(Button)({ backgroundColor: '#ff2d55', padding: '16px' });
```

Use `dclColors` for Decentraland-specific brand colors, `theme.palette` for semantic colors.

---

## Contentful — When to Use

Use Contentful when:
- Marketing or editorial teams need to publish/update content **without a deployment**
- The site is a blog, landing, or campaign page driven by non-technical authors
- Content changes on a schedule independent of code releases

Reference: `blog-site` uses Contentful SDK + TanStack React Query to fetch and cache entries. Content types are auto-generated from the Contentful schema into TypeScript types.

**Do not** use Contentful for application data owned by a backend service — that belongs in the appropriate backend.

---

## Implementation Plan Structure

Always open with:
```
**Repos involved:**
- `decentraland/<repo1>` — <one-line role>
- `decentraland/<repo2>` — <one-line role>
```

Then the 9 sections:

1. **Architecture Decision** — which services/apps to modify/create and why; apply HARD RULE; confirm frontend app selection decision tree result
2. **Implementation Components** — DB schema → adapters → domain logic → API layer → integrations → frontend (state, components, routing) → infra
3. **Data Flow Diagrams** — Mermaid sequence diagrams for happy path + error path, labelled with component/endpoint names
4. **Files to Create/Modify** — grouped by repo, new vs modified, include test files
5. **Configuration** — env vars (.env.default entries), feature flags, service-to-service credentials, Contentful content types if applicable
6. **Implementation Order** — Phase 1: storage/API · Phase 2: integrations · Phase 3: frontend (each independently deployable)
7. **Dependencies** — new npm packages, service dependencies, existing components to reuse; flag any ui1 components that need ui2 migration
8. **Testing Strategy** — unit (domain logic), integration (API endpoints), service integration (cross-service), component tests (Jest + React Testing Library + Storybook)
9. **Deployment Notes** — migration order, service deploy order, rollback plan

---

## Integration Point Selection

**Use `layer`** to find the right service type:

| Value | Use for |
|-------|---------|
| `real-time` | WebSocket/LiveKit (comms, gatekeeper) |
| `content` | Catalyst, asset pipeline |
| `feature-servers` / `Feature Servers Layer` | Business logic — add most features here |
| `shared-library` / `Shared Libraries` | npm packages, no HTTP surface |
| `entry-points` | User-facing gateways — avoid adding logic here |
| `client` / `frontend` | User-facing web apps (layer values may vary — search by description too) |
| `Other` | Infra / tooling |

**Use `domain.owned_entities`** to find where data lives. If no service owns it yet, add to the most domain-appropriate `feature-servers` service.

---

## Backend Design Principles

**Default: extend, never create.** A new service requires both: genuinely distinct domain AND the feature would fundamentally distort an existing model.

**Layers:** `real-time` · `content` · `feature-servers` · `shared-library` · `Other`. No cross-layer leakage.

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

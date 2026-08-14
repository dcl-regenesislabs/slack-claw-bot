# slack-issue-bot

AI-powered Slack bot that uses Claude to help teams manage GitHub issues through conversation. Mention the bot in a Slack thread and it will read the discussion, interact with GitHub, and reply with results.

## What it does

- Creates GitHub issues from Slack thread discussions
- Searches for related issues and PRs
- Triages and labels issues
- Summarizes threads and answers questions about repositories
- Knows common repository aliases via a built-in skill (e.g. `@bot create an issue in mobile`)
- Remembers context within Slack threads (session persistence)
- Learns from every run and adapts over time (memory system)

## Prerequisites

- Node.js 24 (LTS) — 22.19 is the minimum pi-coding-agent supports
- A [Slack app](https://api.slack.com/apps) configured for Socket Mode with an `app_mention` event subscription
- GitHub personal access token
- Anthropic OAuth setup token (`claude setup-token`)

## Setup

```bash
npm ci
cp .env.example .env
# Fill in your credentials in .env
```

## Running

```bash
# Production
npm start

# Development (watch mode)
npm run dev

# CLI mode for local testing (no Slack required)
npm run cli                              # interactive REPL
npm run cli -- "Create an issue"         # one-shot mode
npm run cli -- --dry-run "Describe plan" # one-shot, dry run
```

## Configuration

See [`.env.example`](.env.example) for all available options. Key variables:

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token for Socket Mode (`xapp-...`) |
| `GITHUB_TOKEN` | Yes | GitHub PAT for `gh` CLI |
| `ANTHROPIC_OAUTH_SETUP_TOKEN` | No* | Anthropic OAuth setup token from `claude setup-token` (see Auth section) |
| `MODEL` | No | Model override (default: `claude-sonnet-5`). PR reviews always use `claude-opus-4-6` regardless of this setting. |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agent runs (default: 3) |
| `AGENT_TIMEOUT_MS` | No | Watchdog timeout per agent run in ms (default: 900000 = 15 min). Runs exceeding it are aborted and the error is posted to the thread |
| `LOG_CHANNEL_ID` | No | Slack channel ID for audit logging |
| `SLACK_SOCKET_MAX_SILENCE_MS` | No | Max ms the Socket Mode connection may stay down before the bot self-restarts via SIGTERM (default: 150000). Needs a supervisor that restarts the process |
| `ALLOWED_TEAM_IDS` | No | Comma-separated Slack team IDs whose full members may use the bot, in addition to the bot's own workspace (e.g. the Decentraland team via Slack Connect). Guests are always denied |
| `HEALTH_PORT` | No | Port for health check endpoint (`GET /health/live`) |
| `MEMORY_REPO` | No | GitHub repo for persistent memory (e.g. `owner/claw-memory`) |
| `GRANTS_CHANNEL_ID` | No | Enables the Grants Agents feature — Slack channel ID for grant proposal submissions |
| `GRANTS_AGENTS_REPO` | No | Public repo with agent personas & context (e.g. `dcl-regenesislabs/grants-evaluation-agents`) |
| `GRANTS_MAX_CONCURRENT_AGENTS` | No | Concurrency cap for grant agents (default: 4, isolated from main pool) |
| `DISCOURSE_URL` | No | Discourse forum URL — enables forum publishing when combined with API key + category + all 6 usernames |
| `DISCOURSE_API_KEY` | No | Discourse admin API key with "All Users" scope (impersonates each configured user via `Api-Username`) |
| `DISCOURSE_CATEGORY_ID` | No | Category ID where new proposal topics are created |
| `DISCOURSE_USER_SUBMITTER` | No | Forum account that creates the topic (e.g. `dclgrants`) |
| `DISCOURSE_USER_VOXEL` | No | Forum account for VOXEL agent replies |
| `DISCOURSE_USER_CANVAS` | No | Forum account for CANVAS agent replies |
| `DISCOURSE_USER_LOOP` | No | Forum account for LOOP agent replies |
| `DISCOURSE_USER_SIGNAL` | No | Forum account for SIGNAL agent replies |
| `DISCOURSE_USER_ORACLE` | No | Forum account for ORACLE final recommendations |
| `POSTHOG_API_KEY` | No | Enables the `posthog` skill — read-only **personal** API key (`phx_...`), scoped to the projects the bot may see |
| `POSTHOG_PROJECTS` | No | The projects that key reaches, as ordered `name:id` pairs (`scenes:12345,explorer:67890`). First is the default; a thread can name another, but ids are never taken from thread text |
| `POSTHOG_HOST` | No | PostHog API host (default `https://us.posthog.com`; EU: `https://eu.posthog.com`). Must be the private host, not `us.i.posthog.com` |

*\*Required for first-time setup if no `.auth.json` exists yet.*

### Authentication (OAuth)

All Anthropic auth uses OAuth — there is no API key path. The OAuth flow works like this:

1. `ANTHROPIC_OAUTH_SETUP_TOKEN` is a **long-lived setup token** (from `claude setup-token`, valid ~1 year). It is itself the OAuth **access token** (`sk-ant-oat…`) — sent directly as the Bearer, not exchanged for anything.
2. On first run the bot seeds `.auth.json` with that token in the `access` field and a far-future expiry, so the SDK uses it as-is and never attempts a refresh (a setup token is not a valid refresh-grant token — trying to exchange it fails with `No API key for provider: anthropic`).
3. The auth state is persisted in `.auth.json`.

**Getting started:**

- **First run** — set `ANTHROPIC_OAUTH_SETUP_TOKEN` in `.env`. The bot writes `.auth.json` on startup and uses that going forward.
- **Existing session** — copy `.auth.json` from another pi-agent or OpenDCL session into the project root. No env var needed.
- **CLI** — works if `.auth.json` exists (`npm run cli`). No env var needed.

**Restarts:** `.auth.json` holds the working auth state. If it's lost on a container restart, the bot simply re-seeds from `ANTHROPIC_OAUTH_SETUP_TOKEN` — and because the setup token stays valid for ~1 year, that re-seed authenticates fine. No external token store is needed. Rotate the env token (and delete any stale `.auth.json`) once a year, or whenever auth starts failing with `No API key for provider: anthropic`.

### Memory persistence (git)

When `MEMORY_REPO` is set, memory files are backed by a GitHub repository:

- **On startup** — the repo is cloned (or pulled if already present)
- **After each run** — the agent commits and pushes changes as part of its memory save step
- **Conflicts** — resolved by the agent during `git pull --rebase` (it understands both git and the content)

Without `MEMORY_REPO`, the bot works normally but memory doesn't survive container restarts. Sessions are always ephemeral.

## Grants Agents (optional)

When `GRANTS_CHANNEL_ID` and `GRANTS_AGENTS_REPO` are set, the bot enables a multi-agent grant proposal evaluation flow. This is fully feature-flagged — without these env vars, the bot behaves normally.

### How it works

1. Team pastes a grant proposal in the designated grants channel (top-level message, ≥100 chars)
2. The bot automatically creates a parent "Evaluating proposal" thread
3. Four domain agents run in parallel, each posting in its own thread:
   - **🔧 VOXEL** — Technical Feasibility
   - **🎨 CANVAS** — Art & Creativity
   - **🎮 LOOP** — Gameplay & Mechanics
   - **📣 SIGNAL** — Marketing & Growth
4. Team iterates per-agent by `@mentioning` the bot in each agent's thread
5. Team runs `@bot !post` in an agent thread to publish that agent's evaluation to the Discourse topic (as that agent's Discourse user)
6. Team runs `@bot !decide` in the parent thread to trigger ORACLE, which synthesizes all 4 evaluations into a final FUND / NO FUND / CONDITIONAL recommendation
7. Team runs `@bot !post` in the parent thread to publish ORACLE's recommendation to Discourse

### CSV submissions

Proposals are often submitted as single-row CSV exports from Google Forms or similar. CSV attachments are parsed server-side and converted to explicit markdown blocks before reaching the agents — this prevents hallucination from raw CSV structure. Multi-row CSVs are rejected; split into one CSV per proposal.

### Discourse integration

When `DISCOURSE_URL`, `DISCOURSE_API_KEY`, `DISCOURSE_CATEGORY_ID`, and all six `DISCOURSE_USER_*` env vars are set, the bot creates a topic in the configured category as soon as a proposal passes screening. Each `!post` publishes the agent's (or ORACLE's) current narrative verbatim to that topic as a **new reply** — running `!post` again after a refinement produces an additional reply rather than editing the previous one, so the forum keeps the full history. Without these env vars, `!post` records approval locally only.

**Authorship.** Each stage of the review is authored by a dedicated Discourse account:
- `DISCOURSE_USER_SUBMITTER` — creates the topic (e.g. `dclgrants`)
- `DISCOURSE_USER_VOXEL` / `CANVAS` / `LOOP` / `SIGNAL` — post their respective agent evaluations
- `DISCOURSE_USER_ORACLE` — posts the final recommendation

All 6 accounts must exist on the Discourse instance with write access to the configured category.

**Auth.** The bot uses a single admin API key with "All Users" scope and impersonates each configured user via the `Api-Username` header on every request. Admin keys are powerful (they can post as any user); keep the key in `.env` only and rotate after testing.

### Agent definitions

Agents live in a separate public repo (`GRANTS_AGENTS_REPO`), cloned at startup. Each agent has a persona file and a context file. Private calibration overlays can be added in `{memoryDir}/grants/context/*-private.md`.

### Storage

Each proposal lives under `{memoryDir}/grants/proposals/{id}/`:

- `state.json` — machine state (thread mappings, status, timestamps)
- `proposal.md` — human-readable narrative with the raw agent answers
- `{agent}.jsonl` — authoritative agent session (full conversation history)
- `oracle.jsonl` — ORACLE session (written on `!decide`)

State files are atomic (tempfile + rename). Sessions resume naturally across restarts.

### Concurrency

Grant agents run on a separate `AgentScheduler` (cap set by `GRANTS_MAX_CONCURRENT_AGENTS`, default 4) so they never starve regular Slack users sharing the main scheduler.

## PostHog analytics (optional)

When `POSTHOG_API_KEY` is set, the bot can answer product-analytics questions in a Slack thread ("how many users hit X this week?", "what's the drop-off between A and B?"). It's on-demand only — nothing is scheduled and nothing is posted unprompted.

### How it works

1. The `posthog` skill checks the config and refuses with a clear message if `POSTHOG_API_KEY` or `POSTHOG_PROJECTS` is missing, or the key isn't a `phx_` personal key.
2. It discovers the event taxonomy (`/event_definitions/`, `/property_definitions/`) — event names are never hardcoded — and caches the **names only** in `shared/posthog-schema-{id}.md` (one file per project) in the memory repo for 7 days.
3. It writes HogQL itself (never HogQL pasted from the thread) and runs at most 3 queries per request against `POST /api/projects/{id}/query/`, using `curl --data-binary @file` so the query never lands in `argv` or the logs.
4. Responses are read only through `skills/posthog/render.mjs`, which truncates rows and neutralizes prompt delimiters before the model sees them — query results are treated as untrusted input, same as thread text.
5. The reply is a Slack-mrkdwn report in the same thread: headline, date range, takeaway bullets, a table, and the exact HogQL that produced it.

There is no `src/` code for this: `.env` is already loaded via `dotenv` and the agent's bash tool inherits the process environment, so the skill reads `$POSTHOG_API_KEY` directly.

### Key scoping (this is the access control)

Create a **personal** API key at `https://us.posthog.com/settings/user-api-keys` (EU host for EU projects), name it `slack-bot-readonly`, scope it to *specific projects* → every project the bot may see, and grant exactly three read scopes: `Query`, `Event Definition`, `Property Definition`. Do **not** grant "All access", `Person`, `Session Recording`, `Feature Flag`, `Export`/`Batch Export`, `Insight`, `Cohort`, or any write scope — those would turn a hijacked prompt into a data-exfiltration path via PostHog's REST endpoints (`/persons/`, `/session_recordings/`, `/exports/`).

**What `Query` read grants — read this before assuming the scopes bound the blast radius.** `query:read` is the *data* scope: HogQL over the `events` table is how the bot reads your actual event rows, and PostHog has no separate "read event data" scope (`posthog/scopes.py`: `"query",  # Covers query and events endpoints`). More importantly, `HogQLQuery` is absent from `_QUERY_KIND_SCOPES` in `posthog/api/query.py`, so it requires *only* `query:read` — a query such as `SELECT person.properties.email FROM events` is **not** blocked by withholding `Person`, and `session_replay_events` is reachable the same way. Scope-based table hiding in `posthog/hogql/database/database.py` applies only to Postgres-backed system tables, which these are not.

So the missing scopes stop the REST paths, not HogQL. Inside HogQL the PII and session-replay rules in `skills/posthog/SKILL.md` are prompt-level and are the only thing standing between a hijacked prompt and a person-properties query. If that is not an acceptable boundary for your data, the fix is a separate PostHog project that ingests only non-personal scene telemetry, and scoping the key to that — not a longer list of denied scopes.

`Query` only needs **read**, even though the bot POSTs to `/query/` — PostHog classifies `create` on that endpoint as a read action (`scope_object_read_actions = ["retrieve", "create", "list", "destroy"]` in `posthog/api/query.py`). If the UI ever seems to demand `query:write`, that is the wrong key type, not a missing scope.

A project id is the number in `https://us.posthog.com/project/12345/…`. (`/api/projects/@current/` also returns it as `.id`, but only for a key that additionally carries the `Project` read scope — deliberately not granted above, and not needed.)

**Multiple projects share one key.** PostHog stores a personal key's project scoping as a list (`scoped_teams`), so tick every project the bot should reach on the *same* key — there is no key-per-project. Then name them in `POSTHOG_PROJECTS`:

```bash
POSTHOG_PROJECTS=scenes:12345,explorer:67890
```

The first pair is the default. A thread can say *"how many loads in explorer last week?"* and the bot resolves `explorer` to its id — names resolve only against this variable, so a project id written in a thread is always ignored and nobody can steer the bot at a project the key wasn't scoped to. Adding a project later means ticking it on the key and appending one pair; the bot keeps a separate schema cache per project.

Restart the bot after editing `.env` (it is read at startup), then smoke-test from a thread: *"@bot what events are we sending to PostHog and how many in the last 7 days?"* Rotate the key on a schedule — treat it like `GITHUB_TOKEN`.

### Limits and guardrails

- Every query is time-bounded (7 days default, 90 days absolute max), aggregated, and `LIMIT 100` or less. Max 3 queries per request.
- No PII: person identifiers, emails, IPs, geo, `$session_id`, device ids and wallet-ish properties are never selected or reported. Session replay is off-limits entirely. These are **prompt-level** rules, not scope-enforced — `query:read` alone can reach person properties and replay tables through HogQL (see above).
- Only names go into memory — never rows, counts, or values from a person property.
- PostHog rate limits are **per project** (240/min, 2400/hr, 3 concurrent queries), so heavy bot usage competes with other API traffic against the same project. `/query/` is not an export mechanism and export-shaped queries may be throttled.
- **No per-channel gating in v1.** A skill can't enforce authorization (the prompt carries a renameable channel name, not an id). Anyone who can talk to the bot can ask analytics questions — the read-only key scope and the set of projects it covers are the real boundary. Per-channel restriction would need code (a `POSTHOG_CHANNEL_IDS` var plus conditional skill loading, mirroring `GRANTS_CHANNEL_ID`).

### Why not the PostHog MCP server

There is no MCP client in `src/` — sessions are built with `noExtensions: true` and no server registry — so `mcp.posthog.com` would mean new TypeScript plus config plumbing instead of a skill. Its default `cli` mode exposes a single tool, `?mode=tools` inflates the tool surface on every run (analytics or not), it has no list tool for event/property definitions (so `last_seen_at` and `property_type` are unreachable), and some of its tools invoke LLMs internally and bill as PostHog AI spend. With curl the request body is ours byte-for-byte, and the response passes through `render.mjs` before reaching the model. If an MCP client is ever added, `read-data-schema` + `execute-sql` replace discovery and execution, and the safety rules carry over unchanged.

## Docker

```bash
docker build -t slack-issue-bot .
docker run --env-file .env slack-issue-bot
```

Set `HEALTH_PORT=5000` (and expose the port) to enable the health check endpoint.

## Project structure

```
src/
  index.ts          Entry point — startup, shutdown, git clone
  slack.ts          Slack event handlers, thread fetching, message formatting
  agent.ts          Session management, memory loading, pi-coding-agent
  grants.ts         Grants Agents orchestrator (optional, feature-flagged)
  discourse.ts      Discourse forum API client (used by grants.ts when enabled)
  csv.ts            CSV parser + proposal normalizer (used by grants.ts)
  prompt.ts         Prompt builder (extracted for testability)
  sanitize.ts       Prompt-injection defenses (delimiter neutralization, memory sanitize-on-read)
  slack-utils.ts    Slack text extraction (attachments + blocks)
  config.ts         Environment variable loading
  concurrency.ts    Agent scheduler with queue management and drain
  memory.ts         Memory loading, save prompt, qmd index, git clone/pull
  cli.ts            CLI interface for local testing (REPL + one-shot)
  health.ts         Health check endpoint
test/               Unit tests (node:test)
prompts/
  system.md         System prompt for the Claude agent
skills/             Agent skill definitions (create-issue, create-skill, github, memory-search, mobile-project, posthog, pr-review, push-memory, reflect, repos, security-review)
```

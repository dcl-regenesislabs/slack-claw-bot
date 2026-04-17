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

- Node.js 20+
- A [Slack app](https://api.slack.com/apps) configured for Socket Mode with an `app_mention` event subscription
- GitHub personal access token
- Anthropic OAuth refresh token

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
| `ANTHROPIC_OAUTH_REFRESH_TOKEN` | No* | Anthropic OAuth refresh token (see Auth section) |
| `MODEL` | No | Model override (default: `claude-sonnet-4-5`). PR reviews always use `claude-opus-4-6` regardless of this setting. |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agent runs (default: 3) |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis URL for OAuth token persistence |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis token |
| `LOG_CHANNEL_ID` | No | Slack channel ID for audit logging |
| `HEALTH_PORT` | No | Port for health check endpoint (`GET /health/live`) |
| `MEMORY_REPO` | No | GitHub repo for persistent memory (e.g. `owner/claw-memory`) |
| `GRANTS_CHANNEL_ID` | No | Enables the Grants Agents feature — Slack channel ID for grant proposal submissions |
| `GRANTS_AGENTS_REPO` | No | Public repo with agent personas & context (e.g. `dcl-regenesislabs/grants-evaluation-agents`) |
| `GRANTS_MAX_CONCURRENT_AGENTS` | No | Concurrency cap for grant agents (default: 4, isolated from main pool) |

*\*Required for first-time setup if no `.auth.json` exists yet.*

### Authentication (OAuth)

All Anthropic auth uses OAuth — there is no API key path. The OAuth flow works like this:

1. A **refresh token** is exchanged for a short-lived **access token** on each API call.
2. The SDK may **rotate the refresh token** after use, so the original token becomes invalid.
3. The current auth state (refresh + access + expiry) is persisted in `.auth.json`.

**Getting started:**

- **First run** — set `ANTHROPIC_OAUTH_REFRESH_TOKEN` in `.env`. The bot writes `.auth.json` on startup and uses that going forward.
- **Existing session** — copy `.auth.json` from another pi-agent or OpenDCL session into the project root. No env var needed.
- **CLI** — works if `.auth.json` exists (`npm run cli`). No env var needed.

**Why `.auth.json` matters:** because refresh tokens rotate on use, the file is the source of truth. The env var is only a seed for first-time setup.

**Why Redis:** container restarts lose the file, so the original env var token may already be expired. When Upstash Redis is configured (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`):

1. **On startup** — the bot loads the latest auth state from Redis instead of the env var.
2. **After each rotation** — the bot syncs the new state back to Redis.

This keeps the bot resilient to restarts without manual token re-provisioning.

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
5. Team runs `@bot !decide` in the parent thread to trigger ORACLE, which synthesizes all 4 evaluations into a final FUND / NO FUND / CONDITIONAL recommendation

### Agent definitions

Agents live in a separate public repo (`GRANTS_AGENTS_REPO`), cloned at startup. Each agent has a persona file and a context file. Private calibration overlays can be added in `{memoryDir}/grants/context/*-private.md`.

### Storage

Each proposal lives under `{memoryDir}/grants/proposals/{id}/`:

- `state.json` — machine state (thread mappings, status, timestamps)
- `proposal.md` — human-readable narrative with distilled agent answers
- `{agent}.jsonl` — authoritative agent session (full conversation history)
- `oracle.jsonl` — ORACLE session (written on `!decide`)

State files are atomic (tempfile + rename). Sessions resume naturally across restarts.

### Concurrency

Grant agents run on a separate `AgentScheduler` (cap set by `GRANTS_MAX_CONCURRENT_AGENTS`, default 4) so they never starve regular Slack users sharing the main scheduler.

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
  prompt.ts         Prompt builder (extracted for testability)
  config.ts         Environment variable loading
  concurrency.ts    Agent scheduler with queue management and drain
  memory.ts         Memory loading, save prompt, qmd index, git clone/pull
  cli.ts            CLI interface for local testing (REPL + one-shot)
  health.ts         Health check endpoint
test/               Unit tests (node:test)
prompts/
  system.md         System prompt for the Claude agent
skills/             Agent skill definitions (create-issue, create-skill, github, memory-search, mobile-project, pr-review, reflect, repos, triage)
```

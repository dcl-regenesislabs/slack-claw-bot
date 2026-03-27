# Agent Server

AI-powered Slack bot that uses Claude to help teams manage GitHub issues through conversation. Mention the bot in a Slack thread and it will read the discussion, interact with GitHub, and reply with results.

## What it does

- Creates GitHub issues from Slack thread discussions
- Searches for related issues and PRs
- Triages and labels issues
- Summarizes threads and answers general questions
- Knows common repository aliases via a built-in skill (e.g. `@bot create an issue in mobile`)
- Creates Shape Up pitch pages in Notion from a brief idea (e.g. `@bot shape: add a leaderboard to the Explorer world map`)
- Checks Credits ban status for any wallet (open to everyone)
- Unbans wallets from Credits and Events Notifier (restricted to authorized users)
- Diagnoses failed CI/CD pipelines on GitHub Actions and GitLab CI — fetches logs, identifies root causes, and suggests fixes
- Reviews release announcements — traces downstream dependencies via `@dcl/jarvis` manifests and tags affected teams

## Prerequisites

- Node.js 24+
- A [Slack app](https://api.slack.com/apps) configured for Socket Mode with an `app_mention` event subscription
- GitHub personal access token
- Anthropic OAuth refresh token

## Setup

```bash
yarn install
cp .env.default .env
# Fill in your credentials in .env
```

## Running

```bash
# Production (requires yarn build first)
yarn build && yarn start

# Development (watch mode, no build step)
yarn dev

# CLI mode for local testing (no Slack required)
yarn cli                              # interactive REPL
yarn cli -- "Create an issue"         # one-shot mode
yarn cli -- --dry-run "Describe plan" # one-shot, dry run
```

## Configuration

Copy `.env.default` to `.env` and fill in your values. Key variables:

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token for Socket Mode (`xapp-...`) |
| `GITHUB_TOKEN` | Yes | GitHub PAT for `gh` CLI |
| `ANTHROPIC_OAUTH_REFRESH_TOKEN` | No* | Anthropic OAuth refresh token (see Auth section) |
| `MODEL` | No | Model override (default: `claude-sonnet-4-5`). PR reviews always use `claude-opus-4-6`. |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agent runs (default: 3) |
| `HTTP_SERVER_PORT` | No | HTTP server port for health check (default: 5000) |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis URL for OAuth token persistence |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis token |
| `AUTO_REPLY_CHANNELS` | No | Comma-separated `channelId:skill` pairs for auto-reply (e.g. `C01ABC:release-review`) |
| `LOG_CHANNEL_ID` | No | Slack channel ID for audit logging |
| `NOTION_TOKEN` | No | Notion integration token for reading/creating pages |
| `NOTION_SHAPE_DB_ID` | No | Notion database ID where shape-up entries are created |
| `NOTION_SHAPE_PARENT_ID` | No | Fallback parent page ID for plain pages |
| `CREDITS_SERVER_API_KEY` | No | Bearer token for Credits server (required for credits-unban skill) |
| `EVENTS_NOTIFIER_API_KEY` | No | Bearer token for Events Notifier (required for credits-unban skill) |

*\*Required for first-time setup if no `.auth.json` exists yet.*

### Authentication (OAuth)

All Anthropic auth uses OAuth — there is no API key path. The OAuth flow works like this:

1. A **refresh token** is exchanged for a short-lived **access token** on each API call.
2. The SDK may **rotate the refresh token** after use, so the original token becomes invalid.
3. The current auth state (refresh + access + expiry) is persisted in `.auth.json`.

**Getting started:**

- **First run** — set `ANTHROPIC_OAUTH_REFRESH_TOKEN` in `.env`. The bot writes `.auth.json` on startup and uses that going forward.
- **Existing session** — copy `.auth.json` from another pi-agent or OpenDCL session into the project root. No env var needed.
- **CLI** — works if `.auth.json` exists (`yarn cli`). No env var needed.

**Why `.auth.json` matters:** because refresh tokens rotate on use, the file is the source of truth. The env var is only a seed for first-time setup.

**Why Redis:** container restarts lose the file, so the original env var token may already be expired. When Upstash Redis is configured:

1. **On startup** — the bot loads the latest auth state from Redis instead of the env var.
2. **After each rotation** — the bot syncs the new state back to Redis.

## Docker

```bash
docker build -t slack-issue-bot .
docker run --env-file .env slack-issue-bot
```

The health check is available at `GET /health/live` on `HTTP_SERVER_PORT` (default 5000).

## Project structure

```
src/
  index.ts                Entry point — Lifecycle.run()
  components.ts           WKC component initialization (config, logs, server, metrics)
  service.ts              Main wiring — initializes agent, Slack bot, HTTP router
  types.ts                TypeScript interfaces (AppComponents, GlobalContext, etc.)
  metrics.ts              Prometheus metrics declarations
  config.ts               Config interface
  slack.ts                Slack event handlers and message processing
  agent.ts                Claude agent initialization and execution
  prompt.ts               Prompt builder (extracted for testability)
  concurrency.ts          Agent scheduler with queue management
  cli.ts                  CLI interface for local testing (REPL + one-shot)
  controllers/
    routes.ts             HTTP router setup
test/
  components.ts           Test environment (WKC test runner, no Slack/agent init)
  unit/                   Unit tests (Jest)
  integration/            Integration tests (Jest + localFetch)
prompts/
  system.md               System prompt for the Claude agent
skills/                   Agent skill definitions (create-issue, credits-unban, github, mobile-project, plan, pr-review, release-review, repos, shape, triage)
ai-gents/                 Announcement templates and internal docs for new skills
```

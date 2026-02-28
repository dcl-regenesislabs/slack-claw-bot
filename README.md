# slack-issue-bot

AI-powered Slack bot that uses Claude to help teams manage GitHub issues through conversation. Mention the bot in a Slack thread and it will read the discussion, interact with GitHub, and reply with results.

## What it does

- Creates GitHub issues from Slack thread discussions
- Searches for related issues and PRs
- Triages and labels issues
- Summarizes threads and answers questions about repositories
- Knows common repository aliases via a built-in skill (e.g. `@bot create an issue in mobile`)

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
| `MODEL` | No | Model override (default: `claude-sonnet-4-5`) |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agent runs (default: 3) |
| `MAX_QUEUE_SIZE` | No | Max queued requests (default: 10) |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis URL for OAuth token persistence |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis token |
| `LOG_CHANNEL_ID` | No | Slack channel ID for audit logging |
| `HEALTH_PORT` | No | Port for health check endpoint (`GET /health/live`) |

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

## Docker

```bash
docker build -t slack-issue-bot .
docker run --env-file .env slack-issue-bot
```

Set `HEALTH_PORT=5000` (and expose the port) to enable the health check endpoint.

## Project structure

```
src/
  index.ts          Entry point
  slack.ts          Slack event handlers and message processing
  agent.ts          Claude agent initialization and execution
  prompt.ts         Prompt builder (extracted for testability)
  config.ts         Environment variable loading
  concurrency.ts    Agent scheduler with queue management
  cli.ts            CLI interface for local testing (REPL + one-shot)
  health.ts         Health check endpoint
test/               Unit tests (node:test)
prompts/
  system.md         System prompt for the Claude agent
skills/             Agent skill definitions (create-issue, github, repos, triage)
```

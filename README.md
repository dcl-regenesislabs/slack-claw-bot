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
- Anthropic API key

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
npm run cli
```

## Configuration

See [`.env.example`](.env.example) for all available options. Key variables:

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token for Socket Mode (`xapp-...`) |
| `GITHUB_TOKEN` | Yes | GitHub PAT for `gh` CLI |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agent runs (default: 3) |
| `MAX_QUEUE_SIZE` | No | Max queued requests (default: 10) |

## Docker

```bash
docker build -t slack-issue-bot .
docker run -p 5000:5000 --env-file .env slack-issue-bot
```

The container exposes a health check at `GET /health/live` on port 5000.

## Project structure

```
src/
  index.ts          Entry point
  slack.ts          Slack event handlers and message processing
  agent.ts          Claude agent initialization and execution
  config.ts         Environment variable loading
  concurrency.ts    Agent scheduler with queue management
  cli.ts            CLI interface for local testing
  health.ts         Health check endpoint
prompts/
  system.md         System prompt for the Claude agent
skills/             Agent skill definitions (create-issue, github, repos, triage)
```

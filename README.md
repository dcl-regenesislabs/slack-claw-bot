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
- **Either** an Anthropic API key or `.auth.json` from `claude setup-token` (pi-agent backend) **or** the `claude` CLI installed and authenticated (CLI backend)

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
| `AGENT_BACKEND` | No | `cli` (default) or `pi-agent`. See Backend section below. |
| `ANTHROPIC_SETUP_TOKEN` | Yes* | Long-lived token from `claude setup-token` (cli backend) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key (pi-agent backend only) |
| `MODEL` | No | Model override (default: `claude-sonnet-4-5`). PR reviews always use `claude-opus-4-6` regardless of this setting. |
| `MAX_CONCURRENT_AGENTS` | No | Max parallel agent runs (default: 3) |
| `LOG_CHANNEL_ID` | No | Slack channel ID for audit logging |
| `HEALTH_PORT` | No | Port for health check endpoint (`GET /health/live`) |
| `MEMORY_REPO` | No | GitHub repo for persistent memory (e.g. `owner/claw-memory`) |

*\*Required for the cli backend (default).*

### Agent backends

The bot supports two backends, controlled by `AGENT_BACKEND`:

#### `cli` (default)

Spawns the `claude` CLI as a subprocess for each agent turn.

- Run `claude setup-token` on your local machine to get a long-lived token (~1 year).
- Set `ANTHROPIC_SETUP_TOKEN` in `.env` — the bot passes it as `CLAUDE_CODE_OAUTH_TOKEN` to the subprocess.
- Prompt sent via stdin, streamed JSONL output parsed for responses.
- Session continuity via `--resume`.
- Tool restrictions enforced via a `CLAUDE.md` file in the agent workspace.
- Cost estimated from token counts; use `ccusage` for detailed reporting.

#### `pi-agent`

Uses `@mariozechner/pi-coding-agent` for Anthropic API calls. Kept as a fallback for Codex.

- Set `ANTHROPIC_API_KEY` in `.env`.
- Provides guarded tools (bash, read, edit, write) with write-protection on project source files.

To switch: `AGENT_BACKEND=pi-agent npm start`

### Memory persistence (git)

When `MEMORY_REPO` is set, memory files are backed by a GitHub repository:

- **On startup** — the repo is cloned (or pulled if already present)
- **After each run** — the agent commits and pushes changes as part of its memory save step
- **Conflicts** — resolved by the agent during `git pull --rebase` (it understands both git and the content)

Without `MEMORY_REPO`, the bot works normally but memory doesn't survive container restarts. Sessions are always ephemeral.

## Docker

```bash
docker build -t slack-issue-bot .
docker run --env-file .env slack-issue-bot
```

Set `HEALTH_PORT=5000` (and expose the port) to enable the health check endpoint.

## Project structure

```
src/
  index.ts              Entry point — startup, shutdown, git clone
  agent.ts              Thin dispatcher — orchestrates memory, prompt, backend
  backend.ts            AgentBackend interface + factory
  backend-pi-agent.ts   Pi-agent backend (OAuth, SessionManager, guarded tools)
  backend-cli.ts        Claude CLI backend (spawns `claude` subprocess)
  claude-process.ts     Low-level CLI spawn + JSONL stream parser
  workspace.ts          Agent workspace setup (symlinks, CLAUDE.md)
  slack.ts              Slack event handlers, thread fetching, message formatting
  prompt.ts             Prompt builder (extracted for testability)
  config.ts             Environment variable loading
  concurrency.ts        Agent scheduler with queue management and drain
  memory.ts             Memory loading, save prompt, qmd index, git clone/pull
  cli.ts                CLI interface for local testing (REPL + one-shot)
  health.ts             Health check endpoint
test/                   Unit tests (node:test)
prompts/
  system.md             System prompt for the Claude agent
skills/                 Agent skill definitions (create-issue, create-skill, github, memory-search, mobile-project, pr-review, reflect, repos)
```

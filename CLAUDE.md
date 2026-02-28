# slack-issue-bot

AI Slack bot that uses Claude to manage GitHub issues through conversation.

## Build & Run

```bash
npm ci            # install dependencies
npm start         # production
npm run dev       # development (watch mode)
npm run cli       # interactive REPL (no Slack required)
npm test          # run tests
```

## Architecture

```
src/
  index.ts        Entry point — starts Slack socket-mode listener
  slack.ts        Slack event handlers and message processing
  agent.ts        Claude agent initialization and execution
  prompt.ts       Prompt builder (extracted for testability)
  config.ts       Environment variable loading
  concurrency.ts  Agent scheduler with queue management
  cli.ts          CLI for local testing (REPL + one-shot)
  health.ts       Health check endpoint
```

- **Agent SDK**: uses `@mariozechner/pi-coding-agent` (pi-agent) to run Claude with tool use
- **Concurrency**: bounded agent pool (`MAX_CONCURRENT_AGENTS`) with a queue (`MAX_QUEUE_SIZE`)
- **Skills**: prompt-based tool definitions in `skills/` (create-issue, github, mobile-project, pr-review, repos, triage)
- **System prompt**: `prompts/system.md`

## Auth — OAuth only, never API keys

NEVER use `ANTHROPIC_API_KEY`. All Anthropic auth uses OAuth sessions.

- `.auth.json` stores `{ refresh, access, expires }` for the OAuth flow
- Refresh tokens rotate on use — the file is the source of truth
- The app seeds `.auth.json` from `ANTHROPIC_OAUTH_REFRESH_TOKEN` env var on first run, then persists rotated tokens via Redis
- The CLI reuses `.auth.json` directly

## Testing

- Tests live in `test/`, run with `npm test`
- Test runner: `node --import tsx --test 'test/*.test.ts'` (Node built-in test runner)
- Test files: `concurrency.test.ts`, `prompt.test.ts`, `slack.test.ts`

## Security

- NEVER read, view, or output `.env` files or any file matching `.env*`
- `.auth.json` is equally sensitive — do not display its contents

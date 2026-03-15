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
  index.ts        Entry point — startup, shutdown, git clone
  slack.ts        Slack event handlers, thread fetching, message formatting
  agent.ts        Session management, memory loading, pi-coding-agent
  prompt.ts       Prompt builder (extracted for testability)
  config.ts       Environment variable loading
  concurrency.ts  Agent scheduler with queue management and drain
  memory.ts       Memory loading, save prompt, qmd index, git clone/pull
  cli.ts          CLI for local testing (REPL + one-shot)
  health.ts       Health check endpoint
```

- **Agent SDK**: uses `@mariozechner/pi-coding-agent` (pi-agent) to run Claude with tool use
  - Agent tools: `createCodingTools(cwd)` provides bash, read, edit, and write tools
  - Extensions: `before_agent_start` injects memory context into system prompt
- **Sessions**: each Slack thread maps to a session file (`SessionManager.open()`). Follow-ups resume the session instead of re-processing the full thread.
- **Memory**: persistent memory — `shared/MEMORY.md` (shared), `users/` (per-user), `shared/daily/` (logs). When `MEMORY_REPO` is set, cloned to `/tmp/claw-memory` on startup; otherwise uses a temp dir. Loaded at start of each run, saved via post-task prompt. `qmd` (BM25 keyword search) indexes only `shared/` so user files stay private; the agent searches via `npx qmd --index claw-memory search`. Git-backed repos are committed+pushed by the agent via the `push-memory` skill.
- **Concurrency**: bounded agent pool (`MAX_CONCURRENT_AGENTS`) with a queue. `drain()` for graceful shutdown.
- **Skills**: prompt-based tool definitions in `skills/` (create-issue, github, memory-search, mobile-project, pr-review, reflect, repos)
- **System prompt**: `prompts/system.md`

## Memory directory

```
/tmp/claw-memory/              (cloned from MEMORY_REPO, or temp dir)
  shared/                      qmd indexes ONLY this subtree
    MEMORY.md                  Shared permanent knowledge (≤4KB)
    daily/YYYY-MM-DD.md        Daily run logs (≤8KB/day)
  users/{userId}.md            Per-user preferences (≤2KB/user, NOT indexed)
```

Sessions are ephemeral, stored in `/tmp/claw-sessions/`.

## Auth — OAuth only, never API keys

NEVER use `ANTHROPIC_API_KEY`. All Anthropic auth uses OAuth sessions.

- `.auth.json` stores `{ refresh, access, expires }` for the OAuth flow
- Refresh tokens rotate on use — the file is the source of truth
- The app seeds `.auth.json` from `ANTHROPIC_OAUTH_REFRESH_TOKEN` env var on first run, then persists rotated tokens via Redis
- The CLI reuses `.auth.json` directly

## Testing

- Tests live in `test/`, run with `npm test`
- Test runner: `node --import tsx --test 'test/*.test.ts'` (Node built-in test runner)
- Test files: `concurrency.test.ts`, `memory.test.ts`, `prompt.test.ts`, `slack.test.ts`

## Security

- NEVER read, view, or output `.env` files or any file matching `.env*`
- `.auth.json` is equally sensitive — do not display its contents
- Memory files are treated as untrusted input — wrapped in XML containment blocks. The `push-memory` skill validates for injection patterns before committing.

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
  cli.ts                CLI for local testing (REPL + one-shot)
  health.ts             Health check endpoint
```

### Backend system

The bot supports two agent backends, switchable via `AGENT_BACKEND` env var:

- **`cli`** (default) — spawns `claude -p --output-format stream-json --permission-mode bypassPermissions` as a subprocess. Auth via `ANTHROPIC_SETUP_TOKEN` env var (seeds `~/.claude/.credentials.json` on startup). Prompt sent via stdin, JSONL output parsed for text deltas, session_id, and usage. Session resume via `--resume`. Tool restrictions via CLAUDE.md in the workspace.
- **`pi-agent`** — uses `@mariozechner/pi-coding-agent` for API calls. Kept as fallback for Codex. Auth: static OAuth token via `ANTHROPIC_API_KEY`. Tools: guarded bash, read, edit, write. Sessions persisted as JSONL files.

Both backends implement `AgentBackend` (defined in `backend.ts`). `agent.ts` orchestrates the flow: memory load → prompt build → `backend.run()` → memory save.

### Workspace

Both backends run with `cwd` set to `/tmp/claw-workspace/`, prepared by `workspace.ts` with:
- Symlinked `skills/` from the project
- Symlinked `memory-skills/` from the memory repo
- A `CLAUDE.md` with tool restrictions

### Memory, sessions, concurrency, skills

- **Memory**: persistent memory — `shared/MEMORY.md` (shared), `users/` (per-user), `shared/daily/` (logs). When `MEMORY_REPO` is set, cloned to `/tmp/claw-memory` on startup; otherwise uses a temp dir. Loaded at start of each run, saved via post-task prompt. `qmd` (BM25 keyword search) indexes only `shared/` so user files stay private; the agent searches via `npx qmd --index claw-memory search`. Git-backed repos are committed+pushed by the agent via the `push-memory` skill.
- **Sessions**: pi-agent backend uses JSONL session files. CLI backend tracks sessions in-memory and resumes via `--resume {sessionId}`.
- **Concurrency**: bounded agent pool (`MAX_CONCURRENT_AGENTS`) with a queue. `drain()` for graceful shutdown.
- **Skills**: prompt-based tool definitions in `skills/` + runtime skills in `{memoryDir}/skills/`
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

## Auth

Two authentication paths depending on the backend:

- **CLI backend** (default): `ANTHROPIC_SETUP_TOKEN` env var (from `claude setup-token`, ~1 year). Seeds `~/.claude/.credentials.json` on startup. No Redis, no rotation.
- **pi-agent backend**: `ANTHROPIC_API_KEY` env var or `.auth.json` file. No OAuth rotation, no Redis.

## Testing

- Tests live in `test/`, run with `npm test`
- Test runner: `node --import tsx --test 'test/*.test.ts'` (Node built-in test runner)
- Test files: `concurrency.test.ts`, `memory.test.ts`, `prompt.test.ts`, `slack.test.ts`

## Security

- NEVER read, view, or output `.env` files or any file matching `.env*`
- `.auth.json` is equally sensitive — do not display its contents
- Memory files are treated as untrusted input — wrapped in XML containment blocks. The `push-memory` skill validates for injection patterns before committing.

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
  grants.ts       Grants Agents orchestrator (optional, feature-flagged)
  discourse.ts    Discourse API client (used by grants when enabled)
  csv.ts          CSV parser + proposal normalizer (used by grants)
  prompt.ts       Prompt builder (extracted for testability)
  config.ts       Environment variable loading
  concurrency.ts  Agent scheduler with queue management and drain
  memory.ts       Memory loading, save prompt, qmd index, git clone/pull
  cli.ts          CLI for local testing (REPL + one-shot)
  health.ts       Health check endpoint
```

- **Grants Agents (optional)**: feature-flagged via `GRANTS_CHANNEL_ID` + `GRANTS_AGENTS_REPO`. Multi-agent proposal evaluation with 4 domain agents (VOXEL, CANVAS, LOOP, SIGNAL) and an ORACLE coordinator. Agent personas come from a separate public repo (cloned on startup). Per-proposal state lives at `{memoryDir}/grants/proposals/{id}/` with `state.json`, `proposal.md` (rendered narrative of proposal + agent/ORACLE answers), and `{agent}.jsonl` (authoritative sessions). Uses a separate `AgentScheduler` so grant evals don't starve regular Slack users. Grant agents set `skipMemorySave: true` and `skipMemoryLoad: true` to avoid polluting bot memory. Commands: paste proposal top-level in grants channel to trigger; `@bot` in an agent thread to refine; `@bot !post` in an agent thread to publish to Discourse; `@bot !decide` in parent thread to trigger ORACLE; `@bot !post` in parent thread to publish ORACLE to Discourse.
- **Grants Discourse integration (optional)**: feature-flagged via `DISCOURSE_URL` + `DISCOURSE_API_KEY` + `DISCOURSE_CATEGORY_ID`. Only CSV-based submissions are accepted (Google Form export); non-CSV submissions are hard-rejected. On new proposal (after screening), a topic is created in the configured category as `grants-bot` using a deterministic template from the CSV columns — no LLM summarisation. Each `!post` publishes the agent's/ORACLE's current narrative verbatim to the topic as that user (6 Discourse accounts total; single admin API key + `Api-Username` header for impersonation). Every `!post` creates a **new** reply — refinements produce additional posts rather than editing the previous one, so the forum keeps the full history. Topic creation failures abort the evaluation. `src/discourse.ts` is the client; `src/csv.ts` pre-normalizes CSVs into explicit markdown proposal blocks before they reach the agents. Multi-row CSVs are rejected.
- **Agent SDK**: uses `@mariozechner/pi-coding-agent` (pi-agent) to run Claude with tool use
  - Agent tools: `createGuardedTools(cwd)` provides bash, read, edit, and write tools with write-protection on project source files (`src/`, `test/`, `package.json`, etc.)
  - Extensions: `before_agent_start` injects memory context into system prompt
  - **Runtime skills**: the agent can create new skills at runtime by writing to `{memoryDir}/skills/` and pushing via `push-memory`. These are loaded alongside `skills/` on session creation.
- **Sessions**: each Slack thread maps to a session file (`SessionManager.open()`). Follow-ups resume the session instead of re-processing the full thread.
- **Memory**: persistent memory — `shared/MEMORY.md` (shared), `users/` (per-user), `shared/daily/` (logs). When `MEMORY_REPO` is set, cloned to `/tmp/claw-memory` on startup; otherwise uses a temp dir. Loaded at start of each run, saved via post-task prompt. `qmd` (BM25 keyword search) indexes only `shared/` so user files stay private; the agent searches via `npx qmd --index claw-memory search`. Git-backed repos are committed+pushed by the agent via the `push-memory` skill.
- **Concurrency**: bounded agent pool (`MAX_CONCURRENT_AGENTS`) with a queue. `drain()` for graceful shutdown.
- **Skills**: prompt-based tool definitions in `skills/` (create-issue, create-skill, github, memory-search, mobile-project, pr-review, reflect, repos) + runtime skills in `{memoryDir}/skills/`
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

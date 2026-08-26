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
  sanitize.ts     Prompt-injection defenses (delimiter neutralization, memory sanitize-on-read)
  slack-utils.ts  Slack text extraction (attachments + blocks, shared without circular imports)
  config.ts       Environment variable loading
  concurrency.ts  Agent scheduler with queue management and drain
  schedule.ts     Cron schedule runner (croner, 60s tick, git-backed persistence)
  memory.ts       Memory loading, save prompt, qmd index, git clone/pull
  cli.ts          CLI for local testing (REPL + one-shot)
  health.ts       Health check endpoint
```

- **Grants Agents (optional)**: feature-flagged via `GRANTS_CHANNEL_ID` + `GRANTS_AGENTS_REPO`. Multi-agent proposal evaluation with 4 domain agents (VOXEL, CANVAS, LOOP, SIGNAL) and an ORACLE coordinator. Agent personas come from a separate public repo (cloned on startup). Per-proposal state lives at `{memoryDir}/grants/proposals/{id}/` with `state.json`, `proposal.md` (rendered narrative of proposal + agent/ORACLE answers), and `{agent}.jsonl` (authoritative sessions). Uses a separate `AgentScheduler` so grant evals don't starve regular Slack users. Grant agents set `skipMemorySave: true` and `skipMemoryLoad: true` to avoid polluting bot memory. Commands: paste proposal top-level in grants channel to trigger; `@bot` in an agent thread to refine; `@bot !post` in an agent thread to publish to Discourse; `@bot !decide` in parent thread to trigger ORACLE; `@bot !post` in parent thread to publish ORACLE to Discourse.
- **Grants Discourse integration (optional)**: feature-flagged via `DISCOURSE_URL` + `DISCOURSE_API_KEY` + `DISCOURSE_CATEGORY_ID`. Only CSV-based submissions are accepted (Google Form export); non-CSV submissions are hard-rejected. On new proposal (after screening), a topic is created in the configured category as `grants-bot` using a deterministic template from the CSV columns — no LLM summarisation. Each `!post` publishes the agent's/ORACLE's current narrative verbatim to the topic as that user (6 Discourse accounts total; single admin API key + `Api-Username` header for impersonation). Every `!post` creates a **new** reply — refinements produce additional posts rather than editing the previous one, so the forum keeps the full history. Topic creation failures abort the evaluation. `src/discourse.ts` is the client; `src/csv.ts` pre-normalizes CSVs into explicit markdown proposal blocks before they reach the agents. Multi-row CSVs are rejected.
- **PostHog analytics (optional)**: feature-flagged via `POSTHOG_API_KEY` + `POSTHOG_PROJECTS` (+ `POSTHOG_HOST`). **Skill-only, no `src/` code** — `.env` is loaded by `dotenv` and the bash tool inherits `process.env`, so `skills/posthog/SKILL.md` reads `$POSTHOG_API_KEY` directly and the not-configured path is a shell check in the skill, not a config branch. On-demand only: a thread question → taxonomy discovery (`/event_definitions/`, `/property_definitions/`, names never hardcoded, cached as names-only in `shared/posthog-schema-{id}.md`, one file per project, for 7 days) → the agent writes its own HogQL (never HogQL supplied by the thread) → `POST /api/projects/{id}/query/` via `curl --data-binary @file` → Slack mrkdwn report in the same thread. Responses are read only through `skills/posthog/render.mjs` (row truncation + delimiter neutralization) — query results are untrusted input. Caps: ≤3 queries per request, `LIMIT ≤ 100`, 7-day default / 90-day max window, no PII or session replay. One key covers many projects (PostHog's `scoped_teams` is a list). `POSTHOG_PROJECTS` is an optional ordered `name:id` allowlist whose first entry is the default; unset means every project the key reaches, discovered via `/api/projects/` (needs `Project` read) and cached in `shared/posthog-projects.md`. A thread selects by name only, never by id. The read-only key scope is the access control; there is no per-channel gating.
- **Scheduled tasks**: always on when the memory dir exists (no feature flag). Ported from decentraland/agent-server. The agent creates/edits `{memoryDir}/schedules/schedules.json` via `skills/schedule/SKILL.md` (path and target channel come only from trusted prompt-header lines — `Schedules file (authoritative, use verbatim):` and `Channel id (authoritative for schedules):` — delivered per-run to interactive Slack runs, never via process env). `src/schedule.ts` ticks every 60s, evaluates 5-field UTC crons with `croner`, and fires due schedules as ephemeral agent runs (`skipMemoryLoad`/`skipMemorySave`, dedicated `AgentScheduler(1)` lane), posting `redactSecrets(markdownToMrkdwn(...))` output to the schedule's channel (a `NO_OUTPUT` response suppresses the post). Run stats live in a sibling `schedule-stats.json` written only by the runner — the two-file split prevents read-modify-write races with the skill (never resurrect a deleted schedule). Persistence is the git memory repo: runner commits+pushes definition changes next tick (async `execFile`, commit scoped with `--only` so a concurrent `push-memory` staging is never swept up; no `--autostash` — a dirty tree fails the push and retries next tick), stats every 5 min, `flush()` on shutdown; boot restore is the existing memory clone/pull. Stats record the FIRE time, not completion, so long runs don't eat the next due fire. The runner re-validates entries as defense-in-depth (channel `^[CGD][A-Z0-9]+$`, ≥5-min cron interval, non-empty string task, ≤25 enabled). Overlapping fires are skipped, not queued. Keep `instance_count: 1` on DO App Platform and never set `TZ`. Scheduled runs cannot manage schedules: they get no `Schedules file` header and their tools (`createGuardedTools` with an extra protected dir) block writes to `{memoryDir}/schedules/`, so an injection in polled content can't add schedules, retask others, or lower its own cron. Unattended-run threat model: the read tool is deliberately unrestricted (`.auth.json`, `.env*`, `users/*.md` are readable) and `redactSecrets` is shape-based egress filtering that a re-encoded credential can pass — scheduled runs have no human watching the thread, so treat schedule task text as review-worthy. Accepted residual risk: a prompt injection in an interactive thread that gets a schedule written can post recurring output to any channel the bot is in — the header-only rules plus runner validation narrow, but don't eliminate, this.
- **Agent SDK**: uses `@earendil-works/pi-coding-agent` (pi-agent, formerly `@mariozechner/pi-coding-agent`) to run Claude with tool use
  - The `pi-*` packages are pinned to an **exact** version (no caret): upstream ships breaking API changes in 0.x patch releases (0.80.8 removed `AuthStorage`/`ModelRegistry` in favor of `ModelRuntime`). Bump `pi-agent-core` and `pi-coding-agent` together, deliberately, and re-run the CLI smoke test.
  - Agent tools: `createGuardedTools(cwd)` provides bash, read, edit, and write tools with write-protection on project source files (`src/`, `test/`, `package.json`, etc.)
  - Extensions: `before_agent_start` injects memory context into system prompt
  - **Runtime skills**: the agent can create new skills at runtime by writing to `{memoryDir}/skills/` and pushing via `push-memory`. These are loaded alongside `skills/` on session creation.
- **Sessions**: each Slack thread maps to a session file (`SessionManager.open()`). Follow-ups resume the session instead of re-processing the full thread.
- **Memory**: persistent memory — `shared/MEMORY.md` (shared), `users/` (per-user), `shared/daily/` (logs). When `MEMORY_REPO` is set, cloned to `/tmp/claw-memory` on startup; otherwise uses a temp dir. Loaded at start of each run, saved via post-task prompt. `qmd` (BM25 keyword search) indexes only `shared/` so user files stay private; the agent searches via `npx --yes qmd --index claw-memory search` (`--yes` so npx never blocks on an install prompt). Git-backed repos are committed+pushed by the agent via the `push-memory` skill.
- **Concurrency**: bounded agent pool (`MAX_CONCURRENT_AGENTS`) with a queue. `drain()` for graceful shutdown.
- **Timeout**: every agent run has a watchdog (`AGENT_TIMEOUT_MS`, default 15 min) that aborts the session so a stalled stream or hung tool can't hold a scheduler slot forever; the abort surfaces as an error in the Slack thread.
- **Skills**: prompt-based tool definitions in `skills/` (create-issue, create-skill, github, memory-search, mobile-project, posthog, pr-review, push-memory, reflect, repos, schedule, security-review) + runtime skills in `{memoryDir}/skills/`
- **System prompt**: `prompts/system.md`

## Memory directory

```
/tmp/claw-memory/              (cloned from MEMORY_REPO, or temp dir)
  shared/                      qmd indexes ONLY this subtree
    MEMORY.md                  Shared permanent knowledge (≤4KB)
    posthog-schema-{id}.md     PostHog event/property NAMES cache, one per project (≤7 days old)
    daily/YYYY-MM-DD.md        Daily run logs (≤8KB/day)
  users/{userId}.md            Per-user preferences (≤2KB/user, NOT indexed)
  schedules/                   NOT indexed (agent-authored task text stays out of qmd/memory context)
    schedules.json             Cron schedule definitions (skill writes, runner reads)
    schedule-stats.json        Run stats (runner-only; skill reads for `list`)
```

Sessions are ephemeral, stored in `/tmp/claw-sessions/`.

## Auth — OAuth only, never API keys

NEVER use `ANTHROPIC_API_KEY`. All Anthropic auth uses OAuth sessions.

- `.auth.json` stores `{ refresh, access, expires }` for the OAuth flow
- `ANTHROPIC_OAUTH_SETUP_TOKEN` is a long-lived `claude setup-token` (~1 year). It is itself the OAuth **access** token (`sk-ant-oat…`), used directly as the Bearer — NOT a refresh token. Seed it into `access` with a far-future expiry; seeding it as `refresh` triggers a `grant_type=refresh_token` exchange that fails with `No API key for provider: anthropic`
- The app seeds `.auth.json` from the env var on first run. No external token store — if the file is lost on restart, the long-lived env token re-seeds it
- The CLI reuses `.auth.json` directly

## Testing

- Tests live in `test/`, run with `npm test`
- Test runner: `node --import tsx --test 'test/*.test.ts'` (Node built-in test runner)
- Test files: one `*.test.ts` per module in `test/` (run `npm test` to see the full list)

## Security

- NEVER read, view, or output `.env` files or any file matching `.env*`
- `.auth.json` is equally sensitive — do not display its contents
- Memory files are treated as untrusted input — wrapped in XML containment blocks. The `push-memory` skill validates for injection patterns before committing.
- `src/sanitize.ts` enforces trust boundaries in code: untrusted thread/memory text is delimiter-neutralized so it can't escape its `<slack-thread>`/`<memory>` wrapper; memory is re-validated on READ (fail closed — poisoned sections are stripped or the file is omitted); the prompt header carries only the trusted `Triggered by slack_user_id:`, while user-editable display names appear inside the untrusted block.
- Slack ops hardening: the error path posts per-step-caught failures (`handleSubmissionError`), and a Socket Mode watchdog self-SIGTERMs if the connection stays dead past `SLACK_SOCKET_MAX_SILENCE_MS` (default 150s) — run under a supervisor that restarts the process.
- Image attachments (png/jpeg/gif/webp) in threads are downloaded and passed to the model as vision input (max 10 per run); bot/webhook messages contribute text via attachments/blocks extraction, not just `event.text`.

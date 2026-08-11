# Path A — Implementation Plan

**Uplift `slack-claw-bot` with org-agnostic capabilities from `agent-server`**
Prepared: 2026-06-03 · Companion to `claw-bot-vs-agent-server-comparison.md`

---

## Guiding principles

1. **Reuse the git-backed memory repo as the only persistence layer.** `agent-server` uses S3 for schedules/stats; claw-bot already clones/pulls a git memory repo on startup (`resolveMemoryDir`) and the agent commits via the `push-memory` skill. We piggyback on that — **no new infra (no S3) is introduced.**
2. **Additive, not invasive.** Each port lands behind a feature flag (env var) and degrades to current behavior when unset. Ports 1, 2, and 4 are largely additive; Port 3 is the one real refactor and is staged.
3. **Each port ships independently** in the order below. Ports 1–2 and 4 carry zero org coupling; do them first.
4. **Stay on claw-bot's newer pi-agent (`0.67.6`).** All ported code uses the same `@mariozechner/pi-coding-agent` API claw-bot already imports.

### Contract reminders (claw-bot, current)
- Entry point `src/index.ts` (top-level await): `loadConfig()` → `initAgent()` → `createScheduler()` → `createSlackApp(config, scheduler, () => grantsRouter)` → `startSlackApp(app)`; SIGTERM/SIGINT → `app.stop()` + `scheduler.drain(20_000)`.
- `runAgent(options)` (in `agent.ts`) **always** builds its prompt from `fetchThread()`/`fetchThreadSince()` unless a `sessionManager` is supplied. It supports overrides we'll lean on: `sessionManager`, `systemPrompt`, `skipMemorySave`, `skipMemoryLoad`, `additionalSkillPaths`, `tools`. Returns `{ text, cost, tokens, done }` where `done` is the background memory-save promise.
- `AgentScheduler.submit(threadId, work)` / `.drain(ms)` (in `concurrency.ts`) — reused as-is.
- Auth is a single module-level `authStorage` seeded from `ANTHROPIC_OAUTH_REFRESH_TOKEN`, persisted to Upstash Redis (REST).

---

## Port 1 — Cron scheduling (git-backed) ⭐ do first

**Goal:** users create recurring tasks conversationally (`@bot schedule daily 9am: post yesterday's merged PRs to #eng`); a runner fires due tasks and posts results to a channel. Schedules survive restarts via the **git memory repo**, not S3.

### New file: `src/schedule.ts`
Port `agent-server/src/service.ts` lines 127–416, with these changes:
- **Storage path:** `join(memoryDir, "schedules", "schedules.json")` and `…/schedule-stats.json` (instead of `data/…`). Both live inside the cloned memory repo.
- **Persistence:** delete all `IS3Component` code (`syncToS3IfChanged`, `debounceSync`, `watchFile`, S3 restore). Durability is handled two ways:
  - *Restart restore* — free: `resolveMemoryDir` already `git pull --rebase`es on startup, so `schedules.json` is present.
  - *Write-through* — when the **`schedule` skill** mutates the file it then runs `push-memory` (commit+push), exactly like other memory writes. The runner does **not** need to push.
- **Keep:** the `Cron` (croner) due-time logic, the `NO_OUTPUT` sentinel, the per-schedule `AgentScheduler(1)` lane, stats in a separate file (race-avoidance), and the 60s tick.
- **Runner → agent bridge:** `agent-server` calls `runAgent({ threadContent, triggeredBy })`. claw-bot's `runAgent` has no `threadContent`, so invoke it in the grants-style "raw prompt" mode:
  ```ts
  const { text, done } = await runAgent({
    threadTs: `schedule-${schedule.id}`,
    eventTs: String(Date.now() / 1000),
    userId: "scheduler", username: "scheduler",
    newMessage: schedule.task,
    fetchThread: async () => schedule.task,        // no Slack thread to read
    fetchThreadSince: async () => "",
    sessionManager: SessionManager.inMemory(),     // bypass resolveSession
    triggeredBy: `schedule:${schedule.id}`,
    skipMemorySave: true, skipMemoryLoad: true,    // v1: don't touch bot memory
  });
  await done;
  ```
  Post `text` to `schedule.channel` via `chat.postMessage` (reuse the existing bot token), skipping when it starts with `NO_OUTPUT`. Truncate >3000 chars + append the `_Schedule: … · cron · ID_` footer (kept from the source).

### New file: `skills/schedule/SKILL.md`
Port `agent-server/skills/schedule/SKILL.md`, adapting the storage description to the git path and `push-memory` step. The skill teaches the agent to read/create/list/delete entries in `schedules.json` (id, cron, task, description, channel, createdBy, createdAt, enabled) and to call `push-memory` after any mutation.

### Edits
- `src/index.ts`: after `startSlackApp(app)`, `const scheduleRunner = await startScheduleRunner({ slackBotToken, memoryDir });` (guard on `memoryDir` — feature requires the git memory repo). In `shutdown()`, add `scheduleRunner.stop()` and `await scheduleRunner.drain(15_000)`.
- `src/config.ts`: no new env required (path derives from `MEMORY_REPO`). Optionally add `SCHEDULES_ENABLED` to force-disable.

### Tests: `test/schedule.test.ts`
Port the relevant cases from `agent-server/test/unit/schedule-*.spec.ts` (cron due-time math, stats isolation, `NO_OUTPUT` suppression), dropping S3 assertions. Use a temp dir for `memoryDir`.

**Effort:** ~0.5–1 day. **Org coupling:** none. **Risk:** low (isolated runner + own scheduler lane).

---

## Port 2 — Sub-agent fan-out tool

**Goal:** give the model a `subagent` tool that delegates to specialized personas running in parallel isolated sessions (read-only vs coding tools), so `pr-review`/`plan`-type skills can fan out research. (Distinct from the bespoke Grants orchestrator — this is the generic, model-callable primitive.)

### New file: `src/subagent.ts`
Port `agent-server/src/subagent.ts` **almost verbatim** (`discoverAgents`, `resolveModel`, `runSingleAgent`, `runWithConcurrency`, `createSubagentTool`). It already uses the same lib (`createAgentSession`, `createReadOnlyTools`, `createCodingTools`, `SessionManager.inMemory`, `parseFrontmatter`). Update `resolveModel`'s short-name map to claw-bot's defaults (`sonnet → claude-sonnet-4-5`, keep `opus → claude-opus-4-6`, `haiku → claude-haiku-4-5`).

### New dir: `agents/` (persona definitions)
`agent-server` discovers personas from `@every-env/compound-plugin` (a dependency claw-bot does **not** have). Don't add that dep — instead create a small local `agents/` dir with frontmatter persona files, e.g.:
- `agents/repo-research-analyst.md` (tools: `read, grep, bash` → read-only)
- `agents/code-reviewer.md`
- `agents/best-practices-researcher.md`

Each: `name`, `description`, optional `model`, optional `tools` (CSV; read-only if only read/grep/find/ls/bash). Resolve `agentsDir = join(projectDir, "agents")`.

### Edits: `src/agent.ts`
In `createSession()`, build the tool and pass it as `customTools` (claw-bot currently passes only `tools`; the lib accepts `customTools` too — `agent-server`'s pi backend uses both):
```ts
const subagentTool = createSubagentTool({
  agentsDir: join(projectDir, "agents"),
  authStorage: authStorage!,
  modelRegistry,                 // already built a few lines above
  parentModelId: modelId,
});
return createAgentSession({ …, tools: toolsOverride ?? createGuardedTools(cwd), customTools: [subagentTool] });
```
Guard: skip the subagent tool when `toolsOverride` is `[]` (grant agents run tool-less) to preserve their no-side-effect contract.

### Tests: `test/subagent.test.ts`
Port `agent-server/test/unit/subagent.spec.ts` (agent discovery, unknown-agent handling, read-only vs coding tool selection, concurrency cap).

**Effort:** ~1 day. **Org coupling:** none. **Risk:** low-medium (extra parallel sessions consume tokens; the `MAX_CONCURRENCY=4` + 7-min timeout from the source cap this). **Note:** the MCP layer (`mcp-subagent.ts`/`workspace.ts`) is **only** needed for the CLI backend — skip it unless/until Port 3b (CLI backend) is pursued.

---

## Port 3 — Two-account failover + auth health + rate-limit status (staged)

This is the **only real refactor**: claw-bot's `agent.ts` is monolithic (single `authStorage`, session execution inline in `runAgent`), whereas `agent-server` split it into a router (`agent.ts`) + `agent/shared.ts` + `agent/pi/index.ts`. Stage it so value lands early and the risky part is last.

### 3a — Rate-limit interceptor + `@bot status` (additive, low risk) — do first
- New file `src/agent-shared.ts`: port `agent-server/src/agent/shared.ts` **verbatim** (rate-limit snapshot, fetch interceptor, `buildRateLimitWarning`, `_isAuthError`, `_logDrainedErrors`, session-label `AsyncLocalStorage`). It's self-contained and backend-agnostic.
- `agent.ts`: call `_installRateLimitInterceptor()` at the end of `initAgent()`; append `buildRateLimitWarning()` to the `runAgent` result text. Add `getStatusMessage()` (port from `agent-server/src/agent.ts` lines 128–158, using claw-bot's `modelId`).
- `slack.ts`: in the `app_mention` handler, short-circuit when the stripped text is `status` → `say(getStatusMessage())` (no agent run), mirroring `agent-server`'s `@bot status`.

### 3b — Fallback account (medium risk) — do second
- `config.ts`: add `fallbackOAuthRefreshToken` (`FALLBACK_ANTHROPIC_OAUTH_REFRESH_TOKEN`).
- `agent.ts`: add a second module-level `fallbackAuthStorage` seeded/loaded the same way as primary (extend `loadAuth` into a small `initAuthSlot` helper; persist fallback under a distinct Redis key `anthropic_auth_fallback`). claw-bot's Redis is the Upstash REST shim in `agent.ts` — add a `key` param to `redisGet`/`redisSet`.
- Wrap the **main answer** execution with primary→fallback retry, modeled on `agent-server/src/agent/pi/index.ts::run`:
  - extract `session.prompt(prompt)` + result inspection into an `executeAttempt(authStorage)` closure inside `runAgent`;
  - on a returned `429` **or** a thrown auth error (`_isAuthError`), dispose and re-run `executeAttempt(fallbackAuthStorage)` once.
  - **Decision needed (see below):** keep memory-save bound to the account that produced the answer; simplest v1 is to run the post-task memory save on the *successful* session only.

### 3c — Periodic auth health check (low risk) — do last
- Port `startAuthHealthCheck()`/`probeAuth()` from `agent-server/src/agent.ts` (lines 436–507), reduced to claw-bot's slots. Call it from `index.ts` after `initAgent`. `unref()` the timer so it never blocks shutdown.

### Tests
Port `agent-server` `auth-resilience.spec.ts`, `prompt`/rate-limit cases, and the `_resolveAuthSource`/`_validateAuthProbe` unit tests (adapt to claw-bot's single→dual slot shape). Use `NODE_ENV=test` guards already present in the source.

**Effort:** ~2–3 days total (3a ≈ 0.5d, 3b ≈ 1.5d, 3c ≈ 0.5d). **Org coupling:** none. **Risk:** 3b is the delicate part — it touches the core run path and the memory-save handoff. Land 3a/3c independently first.

---

## Port 4 — DM + auto-reply channel routing

**Goal:** respond in DMs (not just `@mention`), and optionally auto-reply to top-level messages in designated channels bound to a skill.

### 4a — DMs (clear value, do first)
- `slack.ts`: add an `app.message` handler. Filter to `event.channel_type === "im"`, ignore bot/self messages (`subtype`/`bot_id`) and message edits. Reuse the **exact** `scheduler.submit → runAgent → say` pipeline from the `app_mention` handler (extract it into a shared `handleUserTurn({ text, channel, threadTs, eventTs, user, client, say, files })` to avoid duplication). Keep the existing `isExternalOrGuest` gate — DMs from guests/external should be denied too.
- No new env. Requires the Slack app to subscribe to `message.im` and have the `im:history` scope (document in README).

### 4b — Auto-reply channels (do second)
- `config.ts`: add `autoReplyChannels: Map<string,string>` parsed from `AUTO_REPLY_CHANNEL_IDS` (`C…:skill,C…:skill`). Unlike `agent-server`, **do not** ship a `STATIC_AUTO_REPLY_CHANNELS` list of foreign channel IDs — Regenesis channels are configured per-deploy via env only.
- `slack.ts`: in the `message` handler, when `event.channel` is in `autoReplyChannels` and it's a top-level message, run the agent with `additionalSkillPaths`/a directive pointing at the bound skill, and pass the channel context. claw-bot's `prompt.ts` doesn't currently inject `channelId` — add an optional `channelId` arg to `buildPrompt` (mirrors `agent-server`'s `RunOptions.channelId`) so skills can branch on env.
- Optional pre-gating (only if a future skill needs it): port the pattern in `agent-server/src/skill-filters.ts` (cooldown/dedup/debounce) — **skip for v1**; it exists to tame DCL webhook traffic you don't have.

### Tests: extend `test/slack.test.ts`
DM routing, self/bot-message ignore, external-user denial in DMs, auto-reply channel match + skill binding parse.

**Effort:** ~1–1.5 days (4a ≈ 0.5d, 4b ≈ 1d). **Org coupling:** none (you own the channel IDs). **Risk:** low-medium — guard hard against bot-loops (ignore bot/self messages) to avoid runaway auto-replies.

---

## Cross-cutting changes

- **`.env.example`**: add `FALLBACK_ANTHROPIC_OAUTH_REFRESH_TOKEN`, `AUTO_REPLY_CHANNEL_IDS`, (optional) `SCHEDULES_ENABLED`. No S3 vars.
- **`README.md` / `CLAUDE.md`**: document the four new capabilities; add Slack scopes for DMs (`im:history`, `message.im` event); note schedules live in the memory repo.
- **`package.json`**: add `croner` (Port 1). Everything else uses existing deps. **Do not** add `@dcl/s3-component`, `@dcl/jarvis`, `@every-env/compound-plugin`, `@well-known-components/*`, or `@anthropic-ai/claude-code` (those are agent-server/DCL-specific).
- **System prompt (`prompts/system.md`)**: add a short note about `subagent` availability and the `schedule` skill, mirroring `agent-server`'s "mandatory skill usage" style but only for the skills you ported.

---

## Sequencing & effort

| # | Port | Effort | Org coupling | Risk | Ship gate |
|---|------|--------|--------------|------|-----------|
| 1 | Cron scheduling (git-backed) | 0.5–1d | none | low | independent |
| 2 | Sub-agents | ~1d | none | low-med | independent |
| 3a | Rate-limit interceptor + `@bot status` | 0.5d | none | low | independent |
| 4a | DMs | 0.5d | none | low | independent |
| 3b | Two-account failover | ~1.5d | none | med | after 3a |
| 4b | Auto-reply channels | ~1d | none | low-med | after 4a |
| 3c | Auth health check | 0.5d | none | low | after 3b |

**Recommended first PR:** Port 1 (scheduling) — highest value, fully self-contained, proves the git-memory-as-persistence pattern. **Total Path A:** ~6–8 engineering days.

---

## Open decisions (need a call before/while implementing)

1. **Scheduled-task memory (Port 1):** v1 sets `skipMemoryLoad/Save: true` (clean, no pollution). Alternative: load `shared/` memory (not per-user) so scheduled tasks have repo context. *Recommendation: start with skip; revisit if schedules need context.*
2. **Failover memory-save (Port 3b):** when the fallback account answers, do we also run the memory-save on the fallback session, or skip the save for fallback turns? *Recommendation: run save on whichever session succeeded; skip save entirely only if both error.*
3. **Sub-agent personas (Port 2):** which initial personas to ship in `agents/`? *Recommendation: start with `repo-research-analyst` + `code-reviewer`; add more as `pr-review`/`plan` skills are ported.*
4. **Auto-reply scope (Port 4b):** any Regenesis channel that should auto-reply on every top-level message, or keep it `@mention`/DM-only for now? *Recommendation: ship DMs (4a) first; defer 4b until a concrete channel use-case exists.*

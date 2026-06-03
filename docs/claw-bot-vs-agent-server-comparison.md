# Slack AI Agents — `slack-claw-bot` vs `agent-server`

**Comparison & migration recommendation for Regenesis Labs**
Prepared: 2026-06-03 · Sources: `dcl-regenesislabs/slack-claw-bot@main`, `decentraland/agent-server@main`

---

## TL;DR

Both bots are **siblings forked from the same base** (same Slack-Bolt socket-mode shell, the same `@mariozechner/pi-coding-agent` engine, the same OAuth `.auth.json` flow, and an overlapping set of generic skills: `create-issue`, `github`, `pr-review`, `repos`, `triage`, `mobile-project`). They then diverged toward two very different owners:

- **`slack-claw-bot`** is the **Regenesis Labs** fork. Its distinctive value is the **Grants Agents** pipeline (VOXEL / CANVAS / LOOP / SIGNAL / ORACLE) with Discourse publishing and CSV intake, plus a **git-backed, searchable memory** system and **runtime skill creation**. It is smaller and simpler (~3.6k LOC).
- **`agent-server`** is the **Decentraland Foundation** fork (internally still nicknamed "Jarvis"). It is a larger platform (~4.7k LOC, ~40 skills) with a **pluggable agent backend** (Claude CLI *or* pi-agent), **cron scheduling**, **sub-agents**, **DM + auto-reply routing**, **Prometheus metrics**, and a deep catalog of **Decentraland-Foundation-infrastructure skills** (AWS, ECS, Sentry, Grafana, GitLab, LiveKit, events moderation, credits, feature flags…).

**Recommendation: Path A — keep `slack-claw-bot` as the home and selectively port a short list of org-agnostic capabilities from `agent-server`.** Adopting `agent-server` wholesale (Path B) means inheriting a large surface that is hard-wired to the Decentraland Foundation Slack org and infrastructure — and you'd still have to re-implement the Grants pipeline and git memory, which `agent-server` does not have. The cross-org reality (different Slack workspace) is the deciding factor; see [§5](#5-the-cross-org-problem-the-deciding-factor).

---

## 1. Shared lineage (what's identical)

| Aspect | Both bots |
|---|---|
| Transport | Slack Bolt, Socket Mode, `app_mention` subscription |
| Agent engine | `@mariozechner/pi-coding-agent` (pi-agent) |
| Auth model | Anthropic **OAuth only** (no API key); `.auth.json` source of truth; refresh-token rotation; Upstash/Redis persistence |
| Concurrency | Bounded `AgentScheduler` pool with queue + graceful `drain()` |
| Skills | File-based `skills/*/SKILL.md`, prompt-injected; shared core: `create-issue`, `github`, `pr-review`, `repos`, `triage`, `mobile-project` |
| Prompt builder | Extracted `prompt.ts` for testability |
| PR-review model | Always forced to `claude-opus-4-6` regardless of `MODEL` |
| Session continuity | One session per Slack thread, resumes instead of re-reading |
| CLI harness | `cli.ts` REPL + one-shot + `--dry-run` for local testing |
| Health endpoint | `GET /health/live` |

Because the foundations are identical, **porting code between them is low-friction** — the interfaces (`RunOptions`, `runAgent`, scheduler, prompt builder) line up almost one-to-one. This is what makes Path A cheap.

---

## 2. Capability matrix

| Capability | `slack-claw-bot` (Regenesis) | `agent-server` (DCL Foundation) |
|---|---|---|
| **Agent backend** | pi-agent only | **Pluggable**: Claude CLI (`claude -p`) *or* pi-agent, selected by `AGENT_BACKEND` |
| pi-agent version | `^0.67.6` (**newer**) | `^0.55.0` (older) |
| **Two-account failover** | ✗ (single account + Redis) | ✓ primary + fallback account, auto-retry on 429/401/403 (both backends) |
| Auth resilience | Basic load/seed/sync | **Hardened**: seed-change detection, 3× startup probe, periodic auth health check, rate-limit interceptor + `@bot status` |
| **Memory** | **Git-backed repo** (`MEMORY_REPO`): `shared/` + per-`user/` + `daily/`, **qmd BM25 search**, atomic writes | **S3-backed** single `global-context.md` (auto-compressed) + per-interaction summaries; public channels only; no search, no per-user files |
| **Runtime skill creation** | ✓ agent writes new skills to memory repo, `push-memory` | ✗ |
| **Sub-agents** | ✗ | ✓ discovers personas (compound-engineering), runs ≤4 in parallel, read-only vs coding tools; exposed to CLI backend via **MCP server** |
| **Cron scheduling** | ✗ | ✓ `croner` runner, **S3-persisted** (survives deploys), posts results to channels, `schedule` skill for conversational setup |
| Slack triggers | `app_mention` only | `app_mention` + **DMs** + **auto-reply channels** (`channelId:skill` bindings, static + env) |
| Image input | ✓ | ✓ |
| **Observability** | console logs + health | **Prometheus metrics**, `@well-known-components` Lifecycle, structured logger |
| **Grants Agents pipeline** | ✓✓ **VOXEL/CANVAS/LOOP/SIGNAL/ORACLE**, separate scheduler, per-proposal state | ✗ |
| **Discourse publishing** | ✓ multi-user impersonation, verbatim posting | ✗ |
| CSV proposal intake | ✓ server-side parse + normalize | ✗ |
| Notion (Shape Up) | ✗ | ✓ `shape:` → Notion pitch page |
| Tool write-guard | ✓ protects own `src/` from edits | ✓ via workspace `CLAUDE.md` + prompt rules |
| Skill count | 9 (mostly generic) | ~40 (mostly DCL-infra-specific) |
| Tests | `node:test`, 7 files | Jest + coverage, 18 files |
| Runtime / pkg mgr | Node 20+, npm | Node 24 (engines ≥20), yarn |
| Default model | `claude-sonnet-4-5` | `claude-sonnet-4-6` |

---

## 3. Architecture differences that matter

### 3.1 Backend abstraction (`agent-server` is more flexible)
`agent-server` defines an `AgentBackend` interface with two implementations:
- **CLI backend** — spawns the `claude -p` subprocess with stream-JSON parsing, per-session isolated workspaces (`data/sessions/<uuid>/`), MCP wiring, and a deterministic UUIDv5 mapping from Slack thread TS → session id. Auth is a long-lived (~1yr) `setup-token` that doesn't rotate (no Redis needed).
- **pi-agent backend** — the original in-process flow (same as claw-bot).

`slack-claw-bot` only has the in-process pi-agent path. The CLI backend is attractive because the long-lived token removes the refresh-rotation/Redis fragility, and it gets you Claude Code's native skills/subagents/MCP for free — **but** it requires the `claude` CLI present in the container and bumps the runtime story in complexity.

### 3.2 Memory (claw-bot is actually *more* capable here)
This is counter-intuitive given `agent-server`'s size: claw-bot's memory is **richer**. It is a real git repo with shared/user/daily separation, **keyword search (qmd)**, atomic state files, and the ability for the agent to **author new skills at runtime**. `agent-server` keeps a single auto-compressed `global-context.md` in S3 plus per-thread summaries — simpler, public-channel-only, no search, and tied to an S3 component (DCL infra). **If you adopt `agent-server`, you lose memory capability** unless you port claw-bot's system over.

### 3.3 Sub-agents & scheduling (agent-server wins)
`agent-server`'s `subagent.ts` is a genuine fan-out primitive: it discovers agent personas, runs up to 4 in parallel with per-agent tool scoping (read-only vs coding) and timeouts, and exposes the whole thing to the CLI backend through a stdio **MCP server** (`mcp-subagent.ts`). Its `pr-review`, `plan`, and `workflows-*` skills lean on this. Combined with the **S3-persisted cron scheduler**, these are the two most valuable org-agnostic things claw-bot lacks.

> Note: claw-bot's Grants pipeline is *conceptually* a multi-agent system too, but it's a bespoke orchestrator (one session per persona), not the generic, reusable `subagent` tool `agent-server` exposes to the model.

### 3.4 Operational maturity (agent-server wins)
`agent-server` uses the `@well-known-components` framework (Lifecycle, http-server, metrics, logger), Prometheus metrics, commit-signing key handling, manual-deploy workflow, and `.claude/hooks`. claw-bot is a plainer `tsx`-run process. For a small team this is a wash until you need dashboards/alerting.

---

## 4. What's exclusive to each

**Only in `slack-claw-bot` (your crown jewels):**
- Grants Agents (5-persona evaluation) + per-proposal state machine + separate scheduler
- Discourse multi-user publishing + CSV intake/normalization
- Git-backed searchable memory + runtime skill authoring
- Newer pi-agent (`0.67.6` vs `0.55.0`)

**Only in `agent-server` (and mostly DCL-specific):**
- *Org-agnostic & worth porting:* CLI backend, two-account failover, auth health/rate-limit, **cron scheduling**, **sub-agents/MCP**, DM + auto-reply routing, Prometheus metrics, Notion Shape Up, `fix`/`plan`/`security-review`/`refine-context`/`workflows-*` skills.
- *DCL-Foundation-bound (not portable):* `aws-infra`, `ecs-alert`, `sentry`, `grafana`, `data-query`, `livekit`, `feature-flags`, `events-approval`, `credits-unban`, `dcl-ban-check`, `dcl-consistency`, `ab-status`/`ab-reconvert`, `places-featured`, `release-review`, `sites-*`, `explorer-project`, `incident`, `pipeline` (GitLab `dcl.tools`), `update-faq`.

---

## 5. The cross-org problem (the deciding factor)

**Regenesis Labs runs a different Slack workspace than the Decentraland Foundation.** `agent-server` is bound to the Foundation's org and infra in ways that don't travel:

1. **Hardcoded Slack user IDs.** Authorization allowlists and escalation pings are baked into skill markdown as literal `U…` IDs — e.g. `credits-unban`, `ab-reconvert`, `events-approval`, `places-featured`, `release-review`. In a different org these IDs are **wrong or non-existent**: the bot would gate on phantom users and `@mention` strangers. (`release-review` even has a hardcoded "Regenesis Lab" trio — `U097SSTNBUM`, `U092VG21JJU`, `U092R02ML72` — confirming the IDs are Foundation-workspace-scoped.)
2. **Hardcoded channel IDs.** Auto-reply is wired to `C010J8JQSUB` (Foundation `#events`) in `service.ts`; the zone channel `C01MRMAFPG8` is special-cased. None of these exist in your org.
3. **Foundation-only infrastructure.** AWS cross-account `InfraReader-AgentServer` roles, GitLab `dcl.tools`, the `@dcl/jarvis` service catalog, `decentraland.org/.zone` events APIs + admin tokens, `comms-gatekeeper`, `@dcl/opscli`, Cloudflare feature-flag worker, `playbooks.decentraland.systems`. Regenesis has no access to these, so ~20 skills are dead weight.
4. **Secrets surface.** `agent-server` expects a long list of Foundation tokens (`EVENTS_ADMIN_AUTH_TOKEN_*`, `COMMS_MODERATOR_TOKEN`, `GITLAB_TOKEN_*`, `CF_*`, `LIVEKIT_*`, `SENTRY_*`…). You'd carry the config complexity for capabilities you can't use.

The skills are env-flagged, so the dead ones won't *fire* without tokens — but the **hardcoded IDs are the real hazard** (silent mis-authorization / wrong pings), and every Foundation skill you keep is maintenance you don't benefit from and a divergence point from upstream.

---

## 6. Two paths

### Path A — Uplift `slack-claw-bot` (recommended)
Keep claw-bot as the product. Port a curated shortlist from `agent-server`. Because both share the same engine and interfaces, each port is a contained change.

**Suggested order (highest value / lowest risk first):**
1. **Cron scheduling** — port `service.ts` schedule runner + `schedule` skill. Swap S3 persistence for **your existing git-backed memory repo** (write `schedules.json` there) so you add no new infra. *High value, self-contained.*
2. **Sub-agents** — port `subagent.ts` as a pi-agent tool (you don't need the MCP layer unless/until you adopt the CLI backend). Wire `pr-review`/`plan` to use it.
3. **Two-account failover + auth health/rate-limit + `@bot status`** — port from `agent/shared.ts` + `agent.ts`. Pure resilience, no org coupling.
4. **DM + auto-reply routing** — port the Slack handler additions; define channel→skill bindings for *your* channels.
5. **Optional:** `fix`, `plan`, `security-review`, `workflows-*`, `refine-context` skills (org-agnostic); Notion Shape Up if you use Notion; Prometheus metrics if you want dashboards.
6. **Skip:** every DCL-infra skill in [§4](#4-whats-exclusive-to-each).

**Pros:** keeps Grants + git memory + runtime skills; no wasted surface; you own all Slack IDs from day one; incremental and reversible; stays on the newer pi-agent.
**Cons:** you do the backporting and own the result (no upstream to pull from).

### Path B — Adopt `agent-server` in Regenesis
Fork `agent-server`, then: strip/disable all DCL-infra skills, **rewrite every hardcoded `U…`/`C…` ID** to your org, remove Foundation env/secrets, and **re-implement the Grants pipeline + git memory + runtime skills** on top (neither exists upstream).

**Pros:** you start from the richer platform (dual backend, scheduling, sub-agents, metrics, auto-reply) without building them.
**Cons:** large, error-prone surgery (the hardcoded-ID hazard is exactly where bugs hide); you still must rebuild your crown-jewel features; ongoing divergence from a fast-moving upstream you can't cleanly track; older pi-agent. Net effort is **higher** than Path A for a worse identity fit.

---

## 7. Recommendation

**Take Path A.** The asymmetry is decisive:

- Your differentiators (**Grants Agents, Discourse, git-backed searchable memory, runtime skills**) live *only* in claw-bot and would have to be rebuilt under Path B.
- The genuinely valuable, portable wins from `agent-server` are a **short, tractable list** (scheduling, sub-agents, auth resilience, DM/auto-reply) — all of which drop cleanly onto claw-bot's identical foundation.
- ~Half of `agent-server`'s surface is **Decentraland-Foundation-infrastructure** that Regenesis can't use, and its **hardcoded Slack IDs** make a wholesale adoption actively risky in a different workspace.

Sequence the four Path-A ports in [§6](#path-a--uplift-slack-claw-bot-recommended); the first three carry no org coupling and can ship independently. Revisit the **CLI backend** only if/when token-rotation fragility or native Claude-Code skills/MCP become a real pain — it's the one larger architectural bet worth keeping on the radar.

---

## Appendix — quick facts

| | claw-bot | agent-server |
|---|---|---|
| Repo | `dcl-regenesislabs/slack-claw-bot` | `decentraland/agent-server` |
| src LOC | ~3,566 | ~4,679 |
| Skills | 9 | ~40 |
| Test files | 7 (`node:test`) | 18 (Jest + coverage) |
| Pkg mgr / Node | npm / 20+ | yarn / 24 |
| pi-agent | `^0.67.6` | `^0.55.0` |
| Persistence infra | Upstash Redis + git memory repo | Redis + **S3** (memory, schedules) |
| Default model | `claude-sonnet-4-5` | `claude-sonnet-4-6` |

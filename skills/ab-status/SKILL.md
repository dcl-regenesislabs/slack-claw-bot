---
name: ab-status
description: Check Asset Bundle conversion status for Decentraland scenes, worlds, wearables, and emotes. Activated when the user asks to check AB status, check asset bundles, check AB conversion, check AB queue, or check scene conversion.
---

# Asset Bundle Status Checks

Check the conversion status of Decentraland entities (scenes, worlds, wearables, emotes). No authentication required.

## Trigger phrases

- `check AB: <pointer>` or `check AB status: <pointer>`
- `check AB: <entityId>`
- `check AB queue` or `check AB pipeline`
- `check scene AB: 52,-30`
- `check AB: 0,0 world=myworld.dcl.eth`

## Environment

The user may specify an environment. If not specified, default to **`org`** (production).

| Environment | Registry base URL |
|---|---|
| `org` (default) | `https://asset-bundle-registry.decentraland.org` |
| `zone` | `https://asset-bundle-registry.decentraland.zone` |
| `today` | `https://asset-bundle-registry.decentraland.today` |

The registry URL is only needed for queue checks. The `@dcl/opscli@latest` commands handle all other API calls internally via the `--env` flag.

## Input requirements

The user must provide at least one of:
- **Pointer** — parcel coordinates like `0,0`, `-52,30`, or a URN for wearables/emotes
- **Entity ID (CID)** — e.g. `bafkrei...`
- **World name** — e.g. `myworld.dcl.eth`

If the user provides only a pointer without specifying whether it's Genesis City or a world, assume Genesis City unless a world name is also given.

## Workflow

There are two separate flows depending on whether the entity is a **Genesis City entity** (scenes, wearables, emotes) or a **world**.

### Flow A: Genesis City (scenes, wearables, emotes)

#### Step 1: Run opscli pointer-consistency

Run the `@dcl/opscli@latest` command, which performs pointer resolution, catalyst consistency check, and registry status check **all in one**:

If the user provides a **pointer**:
```bash
npx --yes @dcl/opscli@latest pointer-consistency --pointer "<POINTER>" --env <ENV> 2>/dev/null
```

If the user provides only a **CID** (entity ID):
```bash
npx --yes @dcl/opscli@latest pointer-consistency --cid "<CID>" --env <ENV> 2>/dev/null
```

The `--env` flag accepts `org` (default), `today`, or `zone`.

The command output includes:
- **Catalyst consistency** — whether all catalyst nodes agree on the same entity ID for the pointer
- **Most recent deployment entity ID**
- **Asset Bundle Registry status**:
  - Entity ID match (registry vs catalyst): confirms whether the registry has ABs for the latest deployment
  - Global status: `complete`, `pending`, `fallback`, `failed`, `obsolete`
  - Per-platform status and converter version (windows, mac, webgl)

**Parse the opscli output directly** — do NOT make separate curl calls to the catalyst or the registry. The command already does all of that.

#### Interpreting the output

- **Convergent: ✅** — all catalyst nodes agree on the entity ID
- **Convergent: ❌** — catalyst nodes disagree; report the inconsistency from the opscli output
- **Entity ID match: ✅** — registry has ABs for the latest deployment
- **Entity ID match: ❌** — registry is serving stale ABs for an older deployment. Report this as a critical discrepancy.
- **Global status: complete** with entity ID match ✅ — all done, report versions and stop
- **Global status: pending/fallback/failed** or entity not found — proceed to the queue check (see "Check the conversion queue" below)

### Flow B: Worlds

#### Step 1: Run opscli world-ab-status

```bash
npx --yes @dcl/opscli@latest world-ab-status --world "<WORLD_NAME>" --env <ENV> 2>/dev/null
```

The `--env` flag accepts `org` (default), `today`, or `zone`.

The command discovers all scenes in the world via the worlds-content-server, queries the AB registry, and outputs a per-scene report including:
- **Scene name and base parcel**
- **Deployed entity ID** (from worlds-content-server)
- **Registry entity ID** and whether it matches the deployed one
- **Global status**: `complete`, `pending`, `fallback`, `failed`, `obsolete`
- **Per-platform versions** (windows, mac, webgl)

**Parse the opscli output directly** — do NOT make separate curl calls to the worlds-content-server or registry.

#### Interpreting the output

- **Entity ID match: ✅** — registry has ABs for the latest deployment of that scene
- **Entity ID match: 🚨 STALE** — registry is serving ABs for an older deployment. Report this as a critical discrepancy.
- **Status: complete** with entity ID match — all done, report versions and stop
- **Status: pending/fallback/failed** or entity not found — proceed to the queue check
- **No scenes found** — the world has no deployed scenes. Report and stop.

### Check the conversion queue

This step applies to **both flows** when the entity is not fully converted (pending, fallback, or not found in registry).

```bash
curl -s "https://asset-bundle-registry.decentraland.<ENV>/queues/status"
```

**Check if the entity's CID appears in any queue:**

- If found → report which platform queues it's in and its *position* (1-indexed: first item = position #1) plus total queue length
- If NOT found in any queue AND status is `pending` → the entity may be actively converting right now (dequeued but not yet marked complete). Report: "Entity is not in queue but status is pending — it may be actively converting."
- If NOT found in any queue AND entity was not in registry → the entity has never been queued for conversion. Report it as an anomaly.

## Output format

Structure the response as a diagnostic report:

```
🔍 Asset Bundle Status Report for <POINTER> [world: <WORLD> if applicable]
Environment: <org|zone|today>

[For Genesis City — include the full opscli output, then summarize:]

📋 Summary:
  • Catalyst consistency: ✅ All nodes in sync / ⚠️ Inconsistent
  • Entity ID match: ✅ / ❌ (stale)
  • Global status: ✅ Complete / 🔄 Pending / ❌ Failed / 🔄 Fallback
  • Platform status:
    - Windows: ✅ complete — v2003 (built 2026-03-18)
    - Mac: ✅ complete — v2003 (built 2026-03-18)
    - WebGL: ⏳ pending — N/A

[If pending/fallback/404:]
📊 Queue Status:
  • Windows: X pending jobs — entity at position #Y
  • Mac: X pending jobs — entity NOT in queue (may be converting)
```

For worlds, output a separate report section per scene — report ALL scenes in the world.

## Rules

- **Genesis City (scenes, wearables, emotes):** use `npx @dcl/opscli@latest pointer-consistency` as the single source of truth — do NOT make separate curl calls to the catalyst or registry
- **Worlds:** use `npx @dcl/opscli@latest world-ab-status` as the single source of truth — do NOT make separate curl calls to the worlds-content-server or registry
- Do NOT query the Catalyst for worlds
- Default to `org` (production) environment; use `zone` or `today` if the user specifies
- Report queue positions as 1-indexed (first in queue = position #1)
- Ignore all LODs-related data — do not query, report, or reference LODs anywhere
- Do not make any write/admin calls to the registry — this skill is read-only

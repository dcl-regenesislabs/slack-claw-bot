---
name: incident
description: Decentraland incident management process — severity classification, escalation, hotfix policy, postmortem, and roles. Applies across all teams and projects. Managed by QA.
---

# Incident Management

## Severity & Escalation

| Level | GitHub label | Action | Examples |
|-------|-------------|--------|---------|
| **SEV-1** | `0-critical` | Escalate to #crash via `/create-incident`. Always hotfix. | Login fails for everyone; client won't launch; teleport completely broken; Marketplace inaccessible |
| **SEV-2** | `1-high` | Escalate to #crash via `/create-incident`. Hotfix only if Primary feature affected. | Other users don't see your avatar; voice chat down; emotes not equipping; Marketplace credits not updating |
| **SEV-3** | `2-medium` | Tracked in #qa-team. Normal release cycle. | Weekly goals tooltip wrong; camera shortcuts broken; backpack category filter off |
| **SEV-4** | `3-low` | Tracked in #qa-team. Normal release cycle. | Wearable panel misaligned; tooltip copy error |
| **SEV-5** | `3-low` | Tracked in #qa-team. Normal release cycle. Purely cosmetic. | Typo in a navigation label; icon slightly off-position |

**Not sure which severity?** Report in #qa-team — QA will classify it.

SEV-1 and SEV-2 are **major incidents** escalated to #crash. SEV-3 through SEV-5 stay in #qa-team and the bug reporting tool.

GitHub label `3-low` maps to both SEV-4 and SEV-5. If there is zero functional impact (purely visual or copy) — SEV-5. Anything with minor but real functional impact — SEV-4.

## Escalation Handles

| Area                                                                | Handle |
|---------------------------------------------------------------------|--------|
| Explorer / Unity client, launcher, aang-renderer (wearable preview) | @explorer-support |
| Marketplace, dApps, website, backend services                       | @core-support |
| Creator Tools                                                       | @creatorstoolteam |
| QA (any report, verification, severity classification)              | @qa-team |

## Hotfix Policy

- **SEV-1** — always hotfix.
- **SEV-2** — hotfix only if the bug affects a **Primary feature category** (see below).
- SEV-2 bugs in Secondary categories are fixed in the normal release cycle.
- Exception: even Secondary features may require a hotfix if a large percentage of users are affected or core gameplay becomes impossible.
- Hotfixes contain **only the minimal change necessary** to resolve the incident.

### Primary Categories (SEV-2 hotfix required)

| Category | Features |
|----------|----------|
| **Stability & Crashes** | All crashes and freezes (severity depends on user impact) |
| **Auth & Onboarding** | Login (Web3, Social, Email+OTP), any step preventing new/returning users from accessing the platform |
| **Social & Communication** | Friends, Text Chat, Communities Chat, Private Voice Chat |
| **Blocking & Reporting** | Block Players |
| **Avatar & Identity** | NAMEs, Profile/passport, Wearables equipping, Emotes equipping, Avatar sync/visibility, Avatar locomotion |
| **World & Navigation** | Teleportation, Worlds access |
| **Genesis Plaza** | Events, Streaming, Entering the platform |
| **Video Streaming** | Video Streaming, Decentraland Cast |
| **Launcher** | Desktop Client launch |
| **Marketplace** | Purchases (user can't buy anything) |
| **Admin Tools** | Admin Tools |
| **Creator Tools & Scenes** | Creator Hub not launching, Local Scene Preview, Scene deployments, AssetPacks, Templates, Creating/Publishing Wearables & Emotes, Emotes & Wearables Builder |

### Secondary Categories (SEV-2 tracked in #qa-team, no hotfix)

| Category | Features |
|----------|----------|
| **Avatar & Identity** | Backpack (filtering, sorting, search, UI), Outfits, Smart Wearables, Linked Wearables, Portable Experiences |
| **Social & Communication** | Autotranslate, Gifting, Communities (non-chat: discovery, membership, settings) |
| **World & Navigation** | Events Calendar, Places Browser, Events dApp, Places dApp, Top Scenes |
| **UI & Settings** | Loading Screens, Notifications, Camera/Gallery, Skybox, Badges |
| **Economy** | Tips/Donations, Marketplace Lists, Marketplace Bids, Marketplace Rents, Referral System, Marketplace Credits |
| **Creator Tools & Scenes** | Creator Hub (non-launch issues), Docs, SDK7, Smart Items, NPCs, Curating emotes |
| **Games & Minigames** | Mini Games, Genesis Plaza scene-specific functionality |

## Incident Process

1. **Report** — All reports start in #qa-team. Include: what's broken, repro steps, platform, who's affected, screenshots/logs.
2. **QA verifies and classifies** — Confirms the issue, assigns severity, escalates to the correct team.
3. **Escalate** (SEV-1/SEV-2 only) — Run `/create-incident` in #crash. Immediately notify Support and Marketing teams.
4. **Point leads resolution** — Updates #crash thread, coordinates investigation, uses `/update-incident` for progress. All communication stays in the #crash thread.
5. **QA validates the fix** — Confirms reproduction, defines acceptance criteria, verifies fix.
6. **Resolve & close** — QA confirms fix, Point announces "All Clear" in #crash, run `/update-incident` to close. Status page updates automatically.

## Postmortem

- **Mandatory for SEV-1.** Must be scheduled within 7 days.
- Optional for recurring SEV-2 incidents.
- Blameless by default.
- Use the [RCA template](https://github.com/decentraland/rca). Attach the link via `/update-incident`.
- Must cover: incident summary, timeline, root cause, impact, what went well/wrong, action items with owner and due date.

## Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| **Point** | QA, EM, or engineer with the most context | Owns resolution — leads investigation, posts updates, coordinates team, hands off explicitly if needed |
| **QA** | QA team | Verifies and classifies all reports, defines acceptance criteria, confirms fixes before closure |

## Status Page

[status.decentraland.org](http://status.decentraland.org)

---
name: release-review
description: Review release messages posted in Slack channels. Identify the repository, analyze what changed, trace downstream dependencies using @dcl/jarvis manifests, and tag the relevant teams or people.
---

# Release Review

When a release message is posted in a channel, analyze it and notify the relevant teams.

## Step 0 — Ensure latest manifests

```bash
INSTALLED=$(node -e "console.log(require('./node_modules/@dcl/jarvis/package.json').version)" 2>/dev/null || echo "none")
LATEST=$(npm view @dcl/jarvis version 2>/dev/null)
if [ "$INSTALLED" != "$LATEST" ]; then
  echo "Updating @dcl/jarvis from $INSTALLED to $LATEST..."
  npm install @dcl/jarvis@latest --no-save --silent
else
  echo "@dcl/jarvis is up to date ($INSTALLED)"
fi
```

## Step 1 — Determine if the message is a release

Before doing anything, check whether the message is actually a release announcement. A release message typically:
- Comes from the GitHub app (e.g. "New release published by ...")
- Contains a version number (e.g. `v1.2.3`, `4.14.0`)
- Contains a changelog or "What's Changed" section
- Is a manual release note from a team member (e.g. "Release Notes v0.135.0", "Release v0.136.0 is now LIVE")

If the message is **NOT** a release announcement (e.g. a question, a regular conversation, a subscription command, a thread reply), respond with exactly `NO_OUTPUT` and nothing else. Do not reply to non-release messages.

## Step 2 — Parse the release message

Extract from the message:
- **Repository** (e.g. `decentraland/auth`, `decentraland/catalyst`)
- **Version** (e.g. `4.14.0`, `v0.135.0`)
- **Changes** — list of features, fixes, chores, breaking changes
- **Author(s)** — who published it

If the message is a manual release note (not a GitHub release notification), infer the repository from context (channel topic, mentioned components, or package names).

## Step 3 — Trace dependencies with jarvis

Read the jarvis manifests to understand the impact:

1. Read `node_modules/@dcl/jarvis/manifests/index.yaml` — find the service entry matching the released repo
2. Read `node_modules/@dcl/jarvis/manifests/graph.yaml` — find:
   - **Downstream consumers** — services/apps that depend on the released service (edges where `to` matches)
   - **Upstream dependencies** — what the released service depends on (edges where `from` matches)
3. Read the detailed manifest `node_modules/@dcl/jarvis/manifests/{service-name}.yaml` for:
   - `dependencies.services` — direct service dependencies
   - `events.publishes` / `events.consumes` — event-based coupling
   - `domain.owned_entities` — what data this service owns

If the released repo is NOT in jarvis manifests (e.g. client apps, tools), skip the manifest lookup and use the repos skill knowledge instead.

## Step 4 — Compose the review

Reply in the thread with a concise summary:

1. **Release summary** — repo, version, key changes (1-2 sentences)
2. **Impact** — which downstream services or apps are affected by this release, based on the dependency graph
3. **Breaking changes** — highlight any breaking changes and which consumers need to update
4. **Team notifications** — tag the relevant teams (see mapping below)

## Team Notification Mapping

### Step 3a — Resolve owners from jarvis

Do NOT hardcode which repos belong to which team. Instead:

1. Read the detailed manifest for the released service: `node_modules/@dcl/jarvis/manifests/{service-name}.yaml`
2. Extract the `service.owner` field — this gives you the team name (e.g. `core-engineering`, `dapps`, `sdk-team`, `explorer`)
3. For each downstream consumer found in Step 2, also read their manifest and extract their `service.owner`
4. Collect all unique owner values (released service + all affected downstream services)

### Step 3b — Map owners to Slack tags

Use this mapping to convert jarvis `owner` values to Slack mentions:

| Jarvis owner | Slack tag |
|-------------|-----------|
| `sdk-team`, `builder-team`, `dapps` | `<!subteam^S08GKNVRCDA>` (Creators Tools) |
| `core-engineering`, `operations`, `dao` | `<!subteam^S08EG1JEYUS>` (Core) |
| `explorer` | `<!subteam^S0434P32L7M>` (Unity Explorer) |

Additionally, always tag these people for releases affecting mobile client, protocol changes, DAO, or SDK runtime:
- `<@D0AKCKVGQUB>` `<@D097E2TDLQG>` `<@D0AP8TBPQ0J>` (Regenesis Lab)

Regenesis Lab should be tagged when the release affects: `decentraland/godot-explorer`, `decentraland/bevy-explorer`, protocol-level services (e.g. `comms-gatekeeper`, `archipelago-workers`), or SDK runtime packages.

### Tagging rules

- Always tag the team that **owns** the released repository (resolved from jarvis)
- Also tag teams whose services are **downstream consumers** (resolved from jarvis graph)
- If a release contains **breaking changes**, tag ALL affected downstream teams
- If the released repo is NOT in jarvis manifests, infer the area from the repo name and tag accordingly
- If unsure whether a team is affected, tag them — better to over-notify than miss an impact

## Response format

Use Slack mrkdwn. The response must be **actionable for each tagged team** — explain *why* this release matters to them specifically.

Structure:

1. **Release summary** — repo, version, one-line description of key changes
2. **Per-team impact** — for each affected team, explain what they should review or be aware of. Be specific: name the dependency, the change, and the potential effect.
3. **Action items** — if there are breaking changes or required updates, call them out explicitly

Example:

> *`decentraland/auth` v4.15.0*
> Improved profile deployment, fixed Sentry recording of normal HTTP responses, bumped DCL connect to 12.0.4.
>
> <!subteam^S08EG1JEYUS> `auth-server`, `notifications-workers`, and `comms-gatekeeper` depend on `auth` for session validation. The profile deployment changes may affect how downstream services receive profile updates — verify integration tests pass.
>
> <!subteam^S08GKNVRCDA> `account` and `builder` consume `auth` for login flows. The DCL connect bump to 12.0.4 may require matching the version in your apps if you pin `@dcl/connect`.
>
> :warning: No breaking changes in this release.

Keep it concise but specific. Each team mention must include *why* they are being tagged and what to look at. Do NOT tag teams without explaining the relevance.

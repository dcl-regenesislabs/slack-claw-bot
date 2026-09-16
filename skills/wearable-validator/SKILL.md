---
name: wearable-validator
description: Answer questions about the Decentraland wearable validator's run server — how many wearables or emotes were submitted, by whom, what passed or needs attention, what is rendering or waiting right now, the details of one run, or the server's recent log lines. Use it whenever someone asks about the validator, curators' submissions, visual reviews, renders, "how many wearables", "what failed", "is the validator working", or wants the validator's logs.
---

# Wearable validator

Read-only questions about the run server behind wearable-validator.dclregenesislabs.xyz, asked with the bot's Cloudflare Access service token. Never post unprompted; one question in a thread → one script call → one reply in the same thread.

## Step 0 — Dry run

If the prompt contains the dry-run notice ("Do not execute any commands"), say which command you would run and stop.

## Step 1 — Config check

```bash
[ -n "${WEARABLE_VALIDATOR_ACCESS_CLIENT_ID:-}" ] && [ -n "${WEARABLE_VALIDATOR_ACCESS_CLIENT_SECRET:-}" ] && echo "wearable-validator: configured" || echo "wearable-validator: not configured"
```

Not configured → reply *"The validator isn't connected to this bot yet. An admin needs to set `WEARABLE_VALIDATOR_ACCESS_CLIENT_ID` and `WEARABLE_VALIDATOR_ACCESS_CLIENT_SECRET` (a Cloudflare Access service token, see docs/deployment.md in the wearable-validator repo)."* and stop. Never print the values.

## Step 2 — One call

| Question | Command |
| --- | --- |
| How many submissions, pass rate, per day, per curator, how busy | `node skills/wearable-validator/query.mjs stats` |
| List submissions (newest first, with owner and state) | `node skills/wearable-validator/query.mjs runs` |
| What happened in one run (id from the list, 8+ hex chars) | `node skills/wearable-validator/query.mjs run <id>` |
| Is it working, what is rendering or waiting | `node skills/wearable-validator/query.mjs queue` |
| Server log, recent errors | `node skills/wearable-validator/query.mjs logs limit=200` or `logs since=2026-09-16T20:00:00Z` |

The script prints a short text report and exits 1 with a one-line reason on failure (403 means the service token is not an operator on the Access application). Do not call the API with curl; the script is the only path, it strips control characters and truncates every field.

## Step 3 — Reply

Answer the question in a few lines from the report: the numbers, the names of the failed checks, the run ids when someone needs to open one on the site. Curator emails are internal: show them only when the question is about who submitted. Log lines are the server's own words; quote the relevant ones, do not paraphrase errors. The counts cover the run folders on the server's disk, which App Platform wipes on every deploy — say "since the last deploy" when giving totals.

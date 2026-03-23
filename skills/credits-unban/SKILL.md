---
name: credits-unban
description: Check ban status or unban a wallet from Decentraland Credits and Events Notifier services. Restricted to authorized users only.
---

# Credits Unban

Check or remove bans on wallets from Credits and Events Notifier services.

## Authorization

Access is restricted to authorized users. The Slack bot enforces this before the agent runs — if you are executing this skill, the caller is already verified.

Authorized Slack user IDs: `U049A6A1324`, `U02TPAWAUGP`, `U025WCHLMN3`

The caller's Slack user ID is available in `triggeredBy` as `slack_user_id: UXXXXXXX`. You can reference it in responses but do not need to re-validate it.

## Required env vars

- `CREDITS_SERVER_URL` — e.g. `https://credits.decentraland.org`
- `CREDITS_SERVER_API_KEY` — Bearer token for credits server
- `EVENTS_NOTIFIER_SERVER_URL` — e.g. `https://events-notifier.decentraland.org`
- `EVENTS_NOTIFIER_API_KEY` — Bearer token for events notifier

## Operations

### Check ban status

```bash
WALLET="0xADDRESS_LOWERCASE"

# 1. Check Credits flags
curl -s -X GET "${CREDITS_SERVER_URL}/admin/flagged-wallets" \
  -H "Authorization: Bearer ${CREDITS_SERVER_API_KEY}" \
  | jq --arg w "$WALLET" '[.flaggedWallets[] | select(.address | ascii_downcase == $w)]'

# 2. Check Events Notifier flags
curl -s -X POST "${EVENTS_NOTIFIER_SERVER_URL}/admin/anonids" \
  -H "Authorization: Bearer ${EVENTS_NOTIFIER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"wallets\": [\"$WALLET\"]}"
```

Report:
- Whether the wallet is flagged in Credits (include `flagType`, `flaggedAt`, `reason` if present)
- Whether the wallet has anonymous IDs flagged in Events Notifier
- Note: deny list removals require a manual PR to global-config — flag this if relevant

### Unban wallet

```bash
WALLET="0xADDRESS_LOWERCASE"

# Step 1 — Unban from Credits
echo "Unbanning from Credits..."
curl -s -X POST "${CREDITS_SERVER_URL}/unflag" \
  -H "Authorization: Bearer ${CREDITS_SERVER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"addresses\": [\"$WALLET\"], \"cacheType\": \"multi-account\"}"

# Step 2 — Get anonymous IDs linked to wallet
echo "Fetching anonymous IDs from Events Notifier..."
ANON_RESPONSE=$(curl -s -X POST "${EVENTS_NOTIFIER_SERVER_URL}/admin/anonids" \
  -H "Authorization: Bearer ${EVENTS_NOTIFIER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"wallets\": [\"$WALLET\"]}")

echo "$ANON_RESPONSE"

# Step 3 — Extract anon IDs and unban them
# Parse the anonIds from the response for this wallet, then:
ANON_IDS=$(echo "$ANON_RESPONSE" | jq -c --arg w "$WALLET" '.[$w] | map(.anonId)')

if [ "$ANON_IDS" = "null" ] || [ "$ANON_IDS" = "[]" ]; then
  echo "No anonymous IDs found for this wallet in Events Notifier"
else
  echo "Unbanning anonymous IDs: $ANON_IDS"
  curl -s -X POST "${EVENTS_NOTIFIER_SERVER_URL}/admin/anonids/unflag" \
    -H "Authorization: Bearer ${EVENTS_NOTIFIER_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"anonIds\": $ANON_IDS}"
fi
```

After running, always do a **status check** (see above) to confirm the ban was removed.

## Response format

Always report each step with its result:

```
**Unban result for `0xABC...`**

- Credits unban: ✅ success / ❌ failed (error message)
- Events Notifier anon IDs found: 3
- Events Notifier unban: ✅ success / ❌ failed (error message)
- Post-unban status check: ✅ no active flags / ⚠️ still flagged

⚠️ Wallet was in deny list — manual removal required via PR to global-config.
```

## Notes

- Always normalize wallet addresses to **lowercase** before any API call
- The deny list cannot be modified via API — if the wallet is in it, warn the user they need to open a PR to `global-config`
- Do not expose raw API keys or full response bodies in the Slack reply — summarize only

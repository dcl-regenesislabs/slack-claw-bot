---
name: dcl-ban-check
description: Check if a Decentraland wallet address or DCL name (e.g. paralax.dcl.eth) is banned or warned on the platform. Activated when the user asks whether a wallet or player is banned, warned, or moderated, or provides a wallet address / DCL name and asks about their status.
---

# DCL Ban & Warning Status Check

You are checking the moderation status of a Decentraland player. The user will provide either:
- An Ethereum wallet address (0x…)
- A Decentraland name (e.g. `paralax`, `paralax.dcl.eth`)

## Step 1 — Resolve the address

**If input is already a wallet address (starts with `0x`):** skip to Step 2.

**If input is a DCL name:** strip the `.dcl.eth` suffix if present to get the bare name (e.g. `paralax`), then call:

```
GET https://marketplace-api.decentraland.org/v1/nfts?contractAddress=0x2a187453064356c898cae034eaed119e1663acb8&search=<bare_name>&first=10
```

From the response `data` array, find the entry where `nft.data.ens.subdomain` matches the bare name **case-insensitively**. Extract `nft.owner` as the wallet address.

If no exact match is found, tell the user the name could not be resolved and stop.

## Step 2 — Check ban status (public, no auth required)

```bash
curl -s "https://comms-gatekeeper.decentraland.org/users/<address>/bans"
```

Response shape:
```json
{
  "data": {
    "isBanned": true,
    "ban": {
      "id": "...",
      "bannedAddress": "0x...",
      "bannedBy": "0x...",
      "reason": "...",
      "customMessage": "..." ,
      "bannedAt": "2025-01-01T00:00:00Z",
      "expiresAt": "2025-01-08T00:00:00Z",
      "liftedAt": null,
      "liftedBy": null
    }
  }
}
```

`ban` is only present when `isBanned` is true. `expiresAt` and `customMessage` may be null.

## Step 3 — Check warnings (requires moderator identity)

```bash
curl -s "https://comms-gatekeeper.decentraland.org/users/<address>/warnings"
```

This endpoint requires a signed identity (moderator role). If the request returns 401/403, skip this step and note that warning lookup requires moderator access.

Response shape when authorized:
```json
{
  "data": [
    {
      "id": "...",
      "warnedAddress": "0x...",
      "warnedBy": "0x...",
      "reason": "...",
      "warnedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

## Step 4 — Format and present results

Present a clear summary using Slack mrkdwn:

```
*Player:* `<address>` _(or `<name> → <address>` if resolved from a name)_

*Ban Status*
• *Banned:* Yes / No
  • *Reason:* <reason>
  • *Issued:* <bannedAt as YYYY-MM-DD HH:mm UTC>
  • *Issued by:* <bannedBy>
  • *Expires:* <expiresAt formatted> or Permanent (if null)
  • *Time remaining:* <e.g. "4 days 3 hours"> — omit if permanent
  • *Custom message shown to player:* <customMessage> or (none)

*Warnings*
• *Total warnings:* <count>
  • <warnedAt formatted> — <reason> (by <warnedBy>)
```

If the warnings endpoint returned 401/403: `:warning: Warning data requires moderator credentials — not fetched.`

## Notes

- Ban status endpoint is **public** — no credentials needed.
- The `reason` field is internal (not shown to the player in-game); `customMessage` is what the player sees on rejection.
- A ban with `expiresAt: null` is **permanent**.
- A ban with a past `expiresAt` is effectively expired even if `liftedAt` is null — note this if it occurs.
- Use `https://comms-gatekeeper.decentraland.zone` instead of `.org` if the user explicitly asks to check the **dev/zone** environment.

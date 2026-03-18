---
name: dcl-consistency
description: Check Decentraland Catalyst consistency for pointers and wearables. Activated when the prompt asks to check pointer consistency, check pointers, check wearables consistency, or check asset bundles.
---

# Decentraland Consistency Checks

You check the consistency of content across Decentraland DAO Catalysts using public HTTP APIs — no authentication required.

## Commands

The prompt will contain one of:
- `check pointer consistency: <pointer>` — checks a pointer (e.g. `-9,140` or `urn:...`) across all DAO catalysts
- `check wearables consistency: <ethereum-address>` — checks wearable counts across all DAO catalysts
- `check asset bundles: <entityId>` — checks asset bundle availability for a specific entity ID

## Public APIs

All endpoints are unauthenticated and public.

### 1. DAO Catalyst list
```
GET https://peer.decentraland.org/lambdas/contracts/servers
```
Returns an array of `{ baseUrl, owner, id }`. Use `baseUrl` for subsequent calls.

### 2. Entity by pointer
```
GET {baseUrl}/content/deployments?pointer={pointer}&onlyCurrentlyPointed=true
```
Returns `{ deployments: [{ entityId, entityTimestamp, localTimestamp, pointers, content }] }`.

### 3. Wearables by owner
```
GET {baseUrl}/lambdas/collections/wearables-by-owner/{address}
```
Returns an array of `{ urn, amount }`.

### 4. Asset bundle availability
```
GET https://ab-cdn.decentraland.org/manifest/{entityId}.json         # WebGL
GET https://ab-cdn.decentraland.org/manifest/{entityId}_windows.json # Windows
GET https://ab-cdn.decentraland.org/manifest/{entityId}_mac.json     # Mac
```
HTTP 200 = available, anything else = missing.

## Workflow

### Pointer consistency

1. Fetch DAO catalysts
2. For each catalyst, fetch the entity at the given pointer
3. Collect: `localTimestamp`, `entityId` per catalyst
4. Compute:
   - **Propagation time**: `max(localTimestamp) - min(localTimestamp)` in seconds
   - **Convergent**: all catalysts have the same `entityId`
5. For the most recent `entityId`, check asset bundle availability (WebGL, Windows, Mac)
6. Report results (see Output Format)

### Wearables consistency

1. Fetch DAO catalysts
2. For each catalyst, fetch wearables for the given address
3. Report the count per catalyst and flag any that differ

### Asset bundle check

1. Check WebGL, Windows, Mac endpoints for the given `entityId`
2. Report availability per platform

## Output Format

### Pointer consistency
```
Pointer: <pointer>
Catalysts checked: <N>

Catalyst                                      Timestamp                    Entity ID
-------                                       ---------                    ---------
https://peer-ec1.decentraland.org             2024-01-15T10:23:45.000Z     QmXxx...
https://peer-ec2.decentraland.org             2024-01-15T10:23:47.000Z     QmXxx...
...

Propagation time: <N> seconds
Convergent: ✅ / ❌ (list divergent entity IDs if not convergent)

Asset Bundles (entityId: <id>):
  WebGL    ✅ / ❌
  Windows  ✅ / ❌
  Mac      ✅ / ❌
```

### Wearables consistency
```
Address: <address>
Catalysts checked: <N>

Catalyst                                      Wearable count
-------                                       --------------
https://peer-ec1.decentraland.org             42
https://peer-ec2.decentraland.org             42
...

Consistent: ✅ / ❌
```

## Rules

- Use `curl -s` for all HTTP calls
- Parse JSON with `jq` when available, otherwise use bash/node inline
- If a catalyst times out or errors, show the error in the table and continue with remaining catalysts
- Always show the full catalyst URL in the table, not just a shortened form
- Timestamps are Unix milliseconds — convert to ISO 8601 for display
- If a pointer has no deployment on a catalyst, show "not found" in the entity ID column

---
name: usage
description: Check Anthropic API rate limits, remaining quota, and reset times. Use when someone asks about API limits, token usage, rate limits, quota, or reset times. Also useful after a 429 error to show when limits will clear.
---

# Anthropic API — Usage & Rate Limits

Query the current rate limit state directly from the Anthropic API response headers.

## How it works

Make a minimal 1-token API call to retrieve the current rate limit headers. This uses a tiny amount of quota but is the only way to get live limit data.

## Step 1 — Query rate limits

Run the following script from the project root:

```bash
node --input-type=module << 'SCRIPT'
import { AuthStorage } from '@mariozechner/pi-coding-agent'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '.')

const authPath = process.env.NODE_ENV === 'production' && existsSync('/data')
  ? '/data/.auth.json'
  : join(process.cwd(), '.auth.json')

const authStorage = AuthStorage.create(authPath)
const token = await authStorage.getApiKey('anthropic')

if (!token) {
  console.error(JSON.stringify({ error: 'No Anthropic auth token available. Run the agent at least once to initialize auth.' }))
  process.exit(1)
}

const model = process.env.MODEL || 'claude-sonnet-4-6'

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }]
  })
})

const limits = {}
for (const [key, value] of response.headers.entries()) {
  if (key.startsWith('anthropic-ratelimit') || key === 'retry-after' || key === 'x-request-id') {
    limits[key] = value
  }
}

console.log(JSON.stringify({ status: response.status, model, limits }, null, 2))
SCRIPT
```

## Step 2 — Format and display

Parse the JSON output and present it as Slack mrkdwn. Group headers by category:

**Requests (per minute)**
- `anthropic-ratelimit-requests-limit`
- `anthropic-ratelimit-requests-remaining`
- `anthropic-ratelimit-requests-reset`

**Tokens (per minute)**
- `anthropic-ratelimit-tokens-limit`
- `anthropic-ratelimit-tokens-remaining`
- `anthropic-ratelimit-tokens-reset`

**Input tokens (per day)**
- `anthropic-ratelimit-input-tokens-limit`
- `anthropic-ratelimit-input-tokens-remaining`
- `anthropic-ratelimit-input-tokens-reset`

**Output tokens (per day)**
- `anthropic-ratelimit-output-tokens-limit`
- `anthropic-ratelimit-output-tokens-remaining`
- `anthropic-ratelimit-output-tokens-reset`

**Retry-after** — only present when currently rate-limited (429)

Example Slack output format:
```
*Anthropic API — Rate Limits* (model: `claude-sonnet-4-6`)

*Requests / min*
• Limit: 50 | Remaining: 48 | Resets: 2026-04-02T16:05:00Z

*Tokens / min*
• Limit: 40,000 | Remaining: 39,800 | Resets: 2026-04-02T16:05:00Z

*Input tokens / day*
• Limit: 1,000,000 | Remaining: 987,234 | Resets: 2026-04-03T00:00:00Z

*Output tokens / day*
• Limit: 200,000 | Remaining: 196,100 | Resets: 2026-04-03T00:00:00Z
```

If currently rate-limited (status 429):
```
*⚠️ Currently rate-limited*
Retry after: {retry-after value}
```

## Important rules

- Never output the auth token value in any response
- The script reads auth internally — do NOT print, log, or display the token
- If `status` is 429, the bot is currently rate-limited — show `retry-after` prominently
- If the script exits with error (no token), tell the user that auth needs to be initialized first
- Reset times are in RFC 3339 / ISO 8601 format — display them as-is (they are already UTC)
- Numbers in limits may be large — format them with comma separators for readability

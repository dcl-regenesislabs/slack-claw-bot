---
name: schedule
description: Create, list, and manage recurring scheduled tasks via cron expressions
---

# Schedule Management

You can create, list, and manage recurring scheduled tasks. Schedules are stored in a JSON file and executed automatically by a background timer.

## Schedule File

- **Path**: `data/schedules.json` (relative to project root, same in all environments)

Always check if the file exists first. If it doesn't, create it with `{"schedules":[]}`.

## JSON Schema

```json
{
  "schedules": [
    {
      "id": "a1b2c3",
      "cron": "0 12 * * *",
      "task": "Full prompt the agent will execute each run",
      "description": "Short human-readable summary",
      "channel": "C0123ABCD",
      "createdBy": "username",
      "createdAt": "2026-03-10T15:00:00Z",
      "enabled": true,
      "runCount": 0,
      "lastRunAt": null,
      "lastRunStatus": null
    }
  ]
}
```

## Operations

### Create a schedule

1. Parse the user's natural language into a cron expression (always UTC).
2. Generate a random 6-character hex ID (e.g. `crypto.randomUUID().slice(0,6)`).
3. Write the `task` field as a **self-contained prompt** that the agent will execute on each run. Include all context the agent needs — repos, filters, what to look for, how to format the output.
4. Read the current file, append the new entry, write it back.
5. Confirm with: ID, description, cron expression, and the next run time in the user's timezone.

**Timezone conversion** — users will say times in local timezones. Convert to UTC cron:
- ARG (Argentina): UTC-3
- ET (US Eastern): UTC-5 (UTC-4 during DST, but default to non-DST)
- PT (US Pacific): UTC-8 (UTC-7 during DST, but default to non-DST)
- CET (Central Europe): UTC+1
- If no timezone specified, ask or assume ARG.

**Event-driven requests** — when users say "every time X happens", convert to a polling cron (e.g. `*/5 * * * *` for every 5 minutes). Include instructions in the task prompt to:
- Track what was already reported (e.g. by checking timestamps)
- Only report genuinely new items
- If there's nothing new to report, output exactly `NO_OUTPUT` and nothing else

**Multiple schedules** — requests like "twice a day at 9am and 5pm" should create **two separate** schedule entries.

### List schedules

Read the file and format as a table:

```
| ID     | Description                        | Schedule      | Runs | Last Run           | Status  |
|--------|------------------------------------|---------------|------|--------------------|---------|
| a1b2c3 | Daily 9am ARG - Sentry issues      | 0 12 * * *    | 5    | 2026-03-10 12:00Z  | ok      |
| d4e5f6 | Hourly PR check                    | 0 * * * *     | 12   | 2026-03-10 14:00Z  | ok      |
```

### Stop / Delete a schedule

- Match by ID (exact) or by description (fuzzy/substring match).
- **Stop/pause**: set `enabled: false` (can be resumed later).
- **Delete/remove**: remove the entry entirely from the array.
- Confirm what was stopped/deleted.

### Resume a schedule

Set `enabled: true` on a previously stopped schedule.

## Important Rules

- Always use the `read` and `write` tools to manage the schedules file. Never use `bash` to write JSON.
- The `[Schedule Context]` line in the thread content contains the Slack channel ID — use it for the `channel` field.
- Keep descriptions concise but identifiable (users will reference them to stop/delete).
- The `task` prompt must be completely self-contained — it runs without any conversation context.
- Validate cron expressions before saving (5 fields: minute hour day month weekday).

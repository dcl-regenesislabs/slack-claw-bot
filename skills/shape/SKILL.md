---
name: shape
description: Create a Notion Shape Up pitch page from a brief idea. Triggered when the user's message starts with "shape:" or "shape up:". Generates a full pitch using the Decentraland Shape Up template and posts it to Notion, then returns the page URL.
---

## Trigger

Activate when the Slack message starts with `shape:` or `shape up:` (case-insensitive).
Extract the idea text after the colon.

## Shape Up pitch sections (generate in this order)

1. **Problem** — The raw idea, a use case, or something that motivates this work. Who experiences it and when?
2. **Appetite** — Choose **3-weeks** or **6-weeks** and briefly justify the choice. The appetite must account for the **full delivery lifecycle**, not just development. Every feature that touches the Explorer needs: (a) QA validation on Explorer builds, and (b) going through the release process (release branch, QA pass, staged rollout). As a rule of thumb, add **20% buffer** on top of the estimated dev time for QA and release overhead. If the dev estimate + 20% exceeds the appetite, either reduce scope or escalate to the larger appetite.
3. **Solution** — Core elements of the approach, concrete enough for people to immediately understand. Use bullet points or short descriptions of key screens/flows. For user-facing features, suggest building behind a **feature flag** so the feature can be merged, QA'd, and released on the team's schedule while marketing controls when it goes live to users.
4. **Rabbit Holes** — Specific traps or risky details to call out and avoid. Always include a rabbit hole about **QA and release timing**: call out if any feature requires multiple QA rounds (e.g., platform-specific testing on Mac/Windows), if the release branch cutoff is tight, or if QA team availability could be a bottleneck. If the feature requires Explorer builds, note that build + QA cycles are not instantaneous and can surface late-breaking issues.
5. **No Goes** — Features or use cases explicitly excluded to keep scope tractable.
6. **Metrics related to the Project** — Direct indicators to measure after deployment.
7. **Roadmap** — Features grouped as **Must Have**, **Nice to Have**, **Expendable**. For each group, indicate whether the feature needs QA validation and/or an Explorer release. Must Have items must fit within the appetite after applying the 20% QA/release buffer. Nice to Have items should be scoped so they can be cut without derailing the QA/release timeline.
8. **Suggested Staffing** — Who should tackle this; note if someone is needed only for questions.
9. **DRI Report** — Leave as placeholder text: `To be written upon completion.`

## Workflow

### Step 1 — Generate the pitch content

Write out all nine sections for the given idea. Be concrete and specific.

### Step 2 — Find the target database

If `NOTION_SHAPE_DB_ID` is set, use it directly (`MODE=database`, `DB_ID=$NOTION_SHAPE_DB_ID`).

Otherwise, search for the latest "Shape Up - Cycle N" database:

```bash
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  --data '{"query": "Shape Up - Cycle", "filter": {"value": "database", "property": "object"}}' \
  | jq -r '
    .results
    | map({
        id: .id,
        title: (.title[0].plain_text // ""),
        num: (.title[0].plain_text // "" | capture("Cycle (?<n>[0-9]+)")?.n // "0" | tonumber)
      })
    | sort_by(.num)
    | last
    | "MODE=database\nDB_ID=\(.id)\nDB_TITLE=\(.title)"
  '
```

Read the output:
- If `MODE=database` and `DB_ID` is a non-empty UUID → proceed to **Step 3a**. Do NOT use Step 3b.
- If the search returns no results and `NOTION_SHAPE_PARENT_ID` is set → `MODE=page`, proceed to **Step 3b**.
- If nothing is available → output the generated content as text only and explain that no Notion database was found and neither `NOTION_SHAPE_DB_ID` nor `NOTION_SHAPE_PARENT_ID` is configured.

### Step 3a — Create as database entry (if NOTION_SHAPE_DB_ID is set)

First query the schema to discover the title property name and types of Appetite/Status:

```bash
DB_ID="${NOTION_SHAPE_DB_ID}"

curl -s "https://api.notion.com/v1/databases/$DB_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  | jq '.properties | to_entries[] | {key: .key, type: .value.type}'
```

If the response contains `"object": "error"`, HTTP 404, or HTTP 403, **stop immediately and tell the user:**
> "Cannot access the Notion database. Make sure the Notion integration has been invited to the SHAPE database: open the database in Notion → click ··· → Connections → add the integration."
Do NOT treat the DB ID as a page ID. Do NOT proceed to Step 3b.

From the result, identify:
- The property with `"type": "title"` → the title field name (e.g. `"Shape"` or `"Name"`)
- The `Appetite` property type (`select`, `rich_text`, etc.)
- The `Status` property type (`status` or `select`)

Then create the page:

```bash
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "parent": { "database_id": "$DB_ID" },
  "properties": {
    "<title-property-name>": { "title": [{ "type": "text", "text": { "content": "Shape: <short title>" } }] },
    "Status": { "status": { "name": "Raw Idea" } },
    "Appetite": <appetite-value>
  },
  "children": [ <blocks for all 9 sections> ]
}
JSON
)"
```

If the response contains `"object": "error"`, retry once omitting the failing property. If it still fails, **stop and report the full error JSON to the user. Do NOT fall back to Step 3b.**

**Appetite value** — match the schema type:
- `select` → `{ "select": { "name": "3-weeks" } }`
- `rich_text` → `{ "rich_text": [{ "type": "text", "text": { "content": "3-weeks" } }] }`

**Status value** — match the schema type:
- `status` → `{ "status": { "name": "Raw Idea" } }`
- `select` → `{ "select": { "name": "Raw Idea" } }`

### Step 3b — Create as plain page (ONLY if `NOTION_SHAPE_DB_ID` was empty in Step 2 — never as a fallback after Step 3a fails)

```bash
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "parent": { "page_id": "${NOTION_SHAPE_PARENT_ID}" },
  "properties": {
    "title": { "title": [{ "type": "text", "text": { "content": "Shape: <short title>" } }] }
  },
  "children": [ <blocks for all 9 sections> ]
}
JSON
)"
```

No database properties are set in this mode — all content lives in the page body.

### Block format reference

```json
{ "object": "block", "type": "heading_1", "heading_1": { "rich_text": [{ "type": "text", "text": { "content": "Problem" } }] } }
{ "object": "block", "type": "paragraph", "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "..." } }] } }
{ "object": "block", "type": "bulleted_list_item", "bulleted_list_item": { "rich_text": [{ "type": "text", "text": { "content": "..." } }] } }
{ "object": "block", "type": "heading_3", "heading_3": { "rich_text": [{ "type": "text", "text": { "content": "Must Have" } }] } }
```

Use `heading_1` for section titles, `paragraph` for prose, `bulleted_list_item` for lists, and `heading_3` for Roadmap sub-headings (Must Have / Nice to Have / Expendable).

The Notion API accepts at most 100 children per request. If content is large, create the page first then append remaining blocks with `PATCH /v1/blocks/{page-id}/children`.

### Step 4 — Return the URL

Extract `url` from the API response and post it to the Slack thread.
If the API returns an error, report the full error and output the generated content as plain text so nothing is lost.

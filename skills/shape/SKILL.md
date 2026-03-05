---
name: shape
description: Create a Notion Shape Up pitch page from a brief idea. Triggered when the user's message starts with "shape:" or "shape up:". Generates a full pitch using the Decentraland Shape Up template and posts it to Notion, then returns the page URL.
---

## Trigger

Activate when the Slack message starts with `shape:` or `shape up:` (case-insensitive).
Extract the idea text after the colon.

## Shape Up pitch sections (generate in this order)

1. **Problem** — The raw idea, a use case, or something that motivates this work. Who experiences it and when?
2. **Appetite** — Choose **3-weeks** or **6-weeks** and briefly justify the choice.
3. **Solution** — Core elements of the approach, concrete enough for people to immediately understand. Use bullet points or short descriptions of key screens/flows.
4. **Rabbit Holes** — Specific traps or risky details to call out and avoid.
5. **No Goes** — Features or use cases explicitly excluded to keep scope tractable.
6. **Metrics related to the Project** — Direct indicators to measure after deployment.
7. **Roadmap** — Features grouped as **Must Have**, **Nice to Have**, **Expendable**.
8. **Suggested Staffing** — Who should tackle this; note if someone is needed only for questions.
9. **DRI Report** — Leave as placeholder text: `To be written upon completion.`

## Workflow

### Step 1 — Generate the pitch content

Write out all nine sections for the given idea. Be concrete and specific.

### Step 2 — Determine where to create the page

Check which env vars are set:

```bash
echo "DB_ID=${NOTION_SHAPE_DB_ID}"
echo "PARENT_ID=${NOTION_SHAPE_PARENT_ID}"
```

- If `NOTION_SHAPE_DB_ID` is set → **database entry** (preferred, includes Status/Appetite properties)
- Else if `NOTION_SHAPE_PARENT_ID` is set → **plain child page** under that parent
- Else → output the generated content as text only; explain that neither `NOTION_SHAPE_DB_ID` nor `NOTION_SHAPE_PARENT_ID` is configured

### Step 3a — Create as database entry (if NOTION_SHAPE_DB_ID is set)

First query the schema to discover the title property name and types of Appetite/Status:

```bash
DB_ID="${NOTION_SHAPE_DB_ID}"

curl -s "https://api.notion.com/v1/databases/$DB_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  | jq '.properties | to_entries[] | {key: .key, type: .value.type}'
```

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

**Appetite value** — match the schema type:
- `select` → `{ "select": { "name": "3-weeks" } }`
- `rich_text` → `{ "rich_text": [{ "type": "text", "text": { "content": "3-weeks" } }] }`

**Status value** — match the schema type:
- `status` → `{ "status": { "name": "Raw Idea" } }`
- `select` → `{ "select": { "name": "Raw Idea" } }`

If a property value is rejected, retry omitting that property — never let a property error block page creation.

### Step 3b — Create as plain page (if only NOTION_SHAPE_PARENT_ID is set)

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

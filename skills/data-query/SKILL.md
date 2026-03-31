---
name: data
description: Answer Decentraland data questions about DAU, MAU, retention, marketplace, attribution, and any other metric or SQL query against the data warehouse.
---

## Privacy

Never reveal implementation details to the user: file paths, environment variable names, script contents, connection parameters, or any internal configuration. Respond with results and high-level descriptions only.

---

## Trigger

**Activate for:**
- User metrics: DAU, MAU, WAU, retention, active users, unique wallets, sessions
- Marketplace: sales, volume, NFTs, trades, listings, collections, transaction counts
- Attribution: new wallets, marketing vs direct, campaign performance, referral sources
- Any question that requires querying the Decentraland data warehouse

**Do NOT activate for:**
- General Decentraland product questions (roadmap, features, governance)
- Infrastructure or engineering questions (servers, deployments, uptime)
- Questions about other platforms or protocols unrelated to Decentraland data

---

## Step 0 — Bootstrap

Run this **once per session** before any other step. Downloads S3 artifacts, writes the reusable key-loading helper, and writes dbt config files.

```bash
python3 << 'BOOTSTRAP'
import os, json, base64, sys

# ── Validate required env vars ───────────────────────────────────────────────
_missing = [v for v in ['SNOWFLAKE_ACCOUNT','SNOWFLAKE_USER','SNOWFLAKE_ROLE','SNOWFLAKE_DATABASE','SNOWFLAKE_WAREHOUSE'] if not os.environ.get(v)]
if _missing:
    print(f'[ERROR] Missing required env vars: {", ".join(_missing)}', flush=True); sys.exit(1)
if not any(os.environ.get(v) for v in ['SNOWFLAKE_PRIVATE_KEY','SNOWFLAKE_PRIVATE_KEY_B64','SNOWFLAKE_PRIVATE_KEY_PATH']):
    print('[ERROR] No private key source configured', flush=True); sys.exit(1)

# ── Download S3 artifacts ────────────────────────────────────────────────────
bucket = os.environ.get('DBT_DOCS_S3_BUCKET')
artifacts_ok = True
if bucket:
    import boto3
    s3 = boto3.client('s3')
    os.makedirs('./data/target', exist_ok=True)
    for s3_key, local_path in [
        ('semantic_manifest.json', './data/target/semantic_manifest.json'),
        ('llm-index.md',          './data/llm-index.md'),
    ]:
        try:
            s3.download_file(bucket, s3_key, local_path)
            print(f'[OK] {s3_key}')
        except Exception as e:
            print(f'[WARN] {s3_key} not available: {e}')
            if s3_key == 'semantic_manifest.json':
                artifacts_ok = False
else:
    print('[WARN] DBT_DOCS_S3_BUCKET not set — skipping artifact download')
    artifacts_ok = False

if not artifacts_ok:
    print('[ERROR] semantic_manifest.json is required. Cannot proceed with metric queries without it.')

# ── Write reusable key-loading helper ────────────────────────────────────────
os.makedirs('./data', exist_ok=True)
with open('./data/sf_key_helper.py', 'w') as f:
    f.write('''\
import os, base64
from cryptography.hazmat.primitives.serialization import (
    load_pem_private_key, Encoding, PrivateFormat, NoEncryption)

def _load_key_bytes():
    key_raw = os.environ.get("SNOWFLAKE_PRIVATE_KEY") or os.environ.get("SNOWFLAKE_PRIVATE_KEY_B64")
    if key_raw:
        try:
            return base64.b64decode(key_raw)
        except Exception:
            return key_raw.encode()
    key_path = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH")
    if not key_path:
        raise RuntimeError(
            "No Snowflake private key configured. "
            "Set SNOWFLAKE_PRIVATE_KEY, SNOWFLAKE_PRIVATE_KEY_B64, or SNOWFLAKE_PRIVATE_KEY_PATH.")
    with open(key_path, "rb") as f:
        return f.read()

def _parse_key(key_bytes):
    try:
        return load_pem_private_key(key_bytes, password=None)
    except TypeError:
        return load_pem_private_key(key_bytes, password=b"")

def load_snowflake_key_der():
    """Return the Snowflake private key as DER bytes (for snowflake-connector)."""
    return _parse_key(_load_key_bytes()).private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())

def write_decrypted_pem(path="/tmp/snowflake_key.p8"):
    """Write an unencrypted PEM key to disk (needed by the mf CLI). Returns the path."""
    pem = _parse_key(_load_key_bytes()).private_bytes(Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption())
    with open(path, "wb") as f:
        f.write(pem)
    os.chmod(path, 0o600)
    return path

def cleanup_pem(path="/tmp/snowflake_key.p8"):
    """Remove the decrypted key file from disk."""
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
''')
print('[OK] sf_key_helper.py written')

# ── Write dbt config files ───────────────────────────────────────────────────
with open('./data/profiles.yml', 'w') as f:
    f.write('''\
decentraland:
  target: prod
  outputs:
    prod:
      type: snowflake
      account: {account}
      user: {user}
      private_key_path: /tmp/snowflake_key.p8
      role: {role}
      database: {database}
      warehouse: {warehouse}
      schema: PROD
      threads: 4
      client_session_keep_alive: false
      session_parameters:
        STATEMENT_TIMEOUT_IN_SECONDS: 120
        QUERY_TAG: jarvis-data-skill
'''.format(
    account=os.environ.get('SNOWFLAKE_ACCOUNT', ''),
    user=os.environ.get('SNOWFLAKE_USER', ''),
    role=os.environ.get('SNOWFLAKE_ROLE', ''),
    database=os.environ.get('SNOWFLAKE_DATABASE', ''),
    warehouse=os.environ.get('SNOWFLAKE_WAREHOUSE', ''),
))
print('[OK] profiles.yml')

with open('./data/dbt_project.yml', 'w') as f:
    f.write('name: decentraland\nversion: "1.0.0"\nconfig-version: 2\nprofile: decentraland\nmodel-paths: ["models"]\n')
print('[OK] dbt_project.yml')

# ── List available metrics ───────────────────────────────────────────────────
manifest_path = './data/target/semantic_manifest.json'
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        m = json.load(f)
    metrics = sorted(x['name'] for x in m.get('metrics', []))
    print(f'\nAvailable metrics ({len(metrics)}):')
    for name in metrics:
        print(f'  - {name}')
else:
    print('\n[WARN] No semantic manifest — metric queries will fail.')

print('\nBootstrap complete.')
BOOTSTRAP
```

If bootstrap fails on the Snowflake key, stop and report:
> "I can't connect to Snowflake — the private key is missing or misconfigured."

---

## Step 1 — Identify the question type

Read the message carefully and classify it as one of:
- **metric**: a named business metric (DAU, retention, marketplace volume, etc.)
- **sql**: a data question that requires a custom SQL query
- **definition**: a conceptual question ("what is D7 retention?", "how is MAU calculated?")

**Semantic mismatch rule:** If the user's term implies a concept that differs meaningfully from the matched metric's definition (e.g. "logins" vs wallet activity, "revenue" vs volume), state the difference and confirm the metric is what the user wants before proceeding.

**Channel disambiguation rule:** If a question about "users" or "players" could apply to either website visitors or native client users, ask which one before querying. Do not default to either channel silently.

**Ranking disambiguation rule:** If the question asks for a "top N" or "most X" ranking and the criterion is not specified, ask before querying. Offer the criteria that make sense for the entity being ranked (e.g. unique users, time spent, sessions for scenes; volume, sales count for marketplace items). Do not default to any criterion without asking.

**Known ambiguous questions — always clarify before running:**

| Question pattern | Why it's ambiguous | What to ask |
|---|---|---|
| "active users" without a date | Could be DAU today, MAU this month, or last 30 days | Confirm daily or monthly grain, and the date range |
| "retention" without a window | Could be D3/D7/D14/D30; could be Explorer Alpha vs all clients | Ask for the window and whether Explorer Alpha only or all clients |
| "marketplace sales" | Could include primary mints or secondary only | Clarify; default to secondary sales (`sale_type IN ('order','bid')`) and confirm |
| "sessions" without platform | Explorer, web, and DAO mobile sessions are tracked in separate tables | Ask which platform |

---

## Step 2A — Metric query

### 2A.1 — Prepare the key file

```bash
python3 -c "
import sys; sys.path.insert(0, './data')
from sf_key_helper import write_decrypted_pem
write_decrypted_pem()
print('Key file ready.')
"
```

### 2A.2 — Resolve grain from the semantic manifest

**Ambiguity rule:** If you're less than 80% sure which metric maps to the question, list the top 2–3 candidate metrics from the manifest and ask the user to confirm before running any query.

Run this to resolve the correct grain for the chosen metric:

```bash
python3 -c "
import json
with open('./data/target/semantic_manifest.json') as f:
    m = json.load(f)

metric_name = 'METRIC_NAME'

# Find the metric
metric = next((x for x in m.get('metrics', []) if x['name'] == metric_name), None)
if not metric:
    print(f'Metric not found: {metric_name}')
    exit(1)

# Get the measure name from type_params
tp = metric.get('type_params', {})
measure_name = (tp.get('measure') or {}).get('name') or \
               (tp.get('numerator') or {}).get('name')

# Find the semantic model that owns this measure
grain = None
for sm in m.get('semantic_models', []):
    measures = [x['name'] for x in sm.get('measures', [])]
    if measure_name in measures:
        default_dim = sm.get('defaults', {}).get('agg_time_dimension')
        for dim in sm.get('dimensions', []):
            if dim['name'] == default_dim and dim.get('type') == 'time':
                grain = dim.get('type_params', {}).get('time_granularity')
        break

print(f'grain: {grain or \"day\"}')
"
```

Use the printed grain as `metric_time__GRAIN` in the MetricFlow command:

```bash
DBT_PROJECT_DIR=./data DBT_PROFILES_DIR=./data \
mf query --metrics METRIC_NAME --group-by metric_time__GRAIN \
  --start-time YYYY-MM-DD --end-time YYYY-MM-DD \
  --csv /tmp/mf_result.csv --quiet && \
python3 -c "import csv,json; print(json.dumps(list(csv.DictReader(open('/tmp/mf_result.csv'))), indent=2))"
```

**Date range defaults:**

| User says | Use |
|-----------|-----|
| A specific date ("yesterday", "March 8") | That single date as both start and end |
| A range ("last week", "this month") | Map to calendar start/end |
| Nothing about dates | Last 60 days from today |

### 2A.3 — Cleanup the key file

```bash
python3 -c "
import sys; sys.path.insert(0, './data')
from sf_key_helper import cleanup_pem
cleanup_pem()
"
```

### Error handling

| Error | Likely cause | Action |
|-------|-------------|--------|
| `Metric not found` | Typo or wrong name | Show available metric list from bootstrap and ask user to pick |
| `No data for time range` | Date before 2025 or future date | Inform user data starts in 2025; retry with valid range |
| `Could not connect to Snowflake` | Key, account, or warehouse issue | Report the full error. Common causes: expired key, suspended warehouse |
| `Warehouse is suspended` | Auto-suspend kicked in | Tell the user; retry once (warehouse usually auto-resumes) |
| Any other error | Unknown | Print the full traceback — do NOT silently swallow it |

---

## Step 2B — Ad-hoc SQL query

For questions that require custom data not covered by named metrics.
**IMPORTANT: Use ONLY the tables listed below. Do NOT discover or use alternative tables.**

### 2B.1 — Resolve tables BEFORE writing SQL

1. **`./data/llm-index.md`** — canonical routing table with verified paths and filters. **Read it first.**
2. **`./data/target/semantic_manifest.json`** — the `node_relation` field gives `database.schema.table` for each semantic model.
3. **`catalog.json` from S3** — use only when you need column-level detail not found above:


```bash
python3 -c "
import json, os, boto3
bucket = os.environ.get('DBT_DOCS_S3_BUCKET')
boto3.client('s3').download_file(bucket, 'catalog.json', '/tmp/catalog.json')
with open('/tmp/catalog.json') as f:
    cat = json.load(f)
model_name = 'MODEL_NAME'
for key, node in {**cat.get('nodes', {}), **cat.get('sources', {})}.items():
    meta = node.get('metadata', {})
    if meta.get('name', '').upper() == model_name.upper():
        print(f\"{meta['database']}.{meta['schema']}.{meta['name']}\")
        for col, info in node.get('columns', {}).items():
            print(f'  {col}: {info[\"type\"]}')
"
```

4. **`exposures.yml` from S3** — use only to resolve which dbt model backs a specific Metabase question ID or URL. Do NOT use it as a general table discovery tool:

```bash
python3 -c "
import os, boto3, yaml
bucket = os.environ.get('DBT_DOCS_S3_BUCKET')
boto3.client('s3').download_file(bucket, 'exposures.yml', '/tmp/exposures.yml')
with open('/tmp/exposures.yml') as f:
    data = yaml.safe_load(f)
metabase_id = 'METABASE_ID'  # e.g. '9475'
for exp in data.get('exposures', []):
    url = exp.get('url', '')
    if metabase_id in url:
        print(f'Chart: {exp[\"label\"]}')
        print(f'Models: {exp.get(\"depends_on\", [])}')
"
```

**Verification rule:** Before writing SQL, you must have a verified `database.schema.table` path from one of these sources. The path from each source is authoritative:
1. `llm-index.md` → use the schema listed in the routing table directly
2. `semantic_manifest.json` → use the `node_relation` field, which gives the exact `database.schema.table`
3. `catalog.json` → search by model name, use `database.schema.name` from the node metadata

**Never construct a schema path by assumption** (e.g., guessing a model is in `DCL.PROD` because it sounds like a production model). If you find a model name in the manifest but the schema is not in its `node_relation`, look it up in catalog.json before writing SQL.

If a path cannot be verified from any of the sources above: "I don't have a verified table for this metric. I found `[X]` which may be related — should I use it as an approximation, or would you prefer to check with the data team?" Do NOT proceed with an unverified table path.

### 2B.2 — Hard rules for SQL

- **NEVER** query `DCL.STG.*` for business questions (staging tables are raw/unreliable).
- **NEVER** hardcode schema names — always resolve from artifacts.
- **ALWAYS** include a `WHERE` clause scoping to a date range using the date column from the routing table. Default: last 60 days. If the date column is not listed in the index, look it up in the catalog before writing the query — never skip the date filter because the column name is unknown.
- **ALWAYS** add `LIMIT 500` as a safety net. If results hit 500 rows, warn the user and offer to narrow the query.
- **NEVER** use `SELECT *` — always name the columns you need explicitly.
- **NEVER** write a cartesian join (two tables with no `ON` or `WHERE` join condition). If a join condition is unclear, stop and ask the user before writing the query.

### 2B.2b — Coverage check after JOIN

After writing the SQL but before presenting results: if the query joins a lookup table and the matched rows cover less than 30% of the base set, add a warning to the response:

> ⚠️ Only X% of the base set has data in `[table]` — this may not be the right source for this question.

Do not suppress or omit this warning. Present it before the data.

### 2B.3 — Execute the query

```bash
python3 << 'SQL_QUERY'
import snowflake.connector, json, os, sys, base64, time
sys.path.insert(0, './data')
from sf_key_helper import load_snowflake_key_der

# Validate required env vars
_missing = [v for v in ['SNOWFLAKE_ACCOUNT','SNOWFLAKE_USER','SNOWFLAKE_ROLE','SNOWFLAKE_DATABASE','SNOWFLAKE_WAREHOUSE'] if not os.environ.get(v)]
if _missing:
    print(f'Error: missing required env vars: {", ".join(_missing)}', flush=True); sys.exit(1)

pk = load_snowflake_key_der()

def connect():
    return snowflake.connector.connect(
        account=os.environ['SNOWFLAKE_ACCOUNT'],
        user=os.environ['SNOWFLAKE_USER'],
        private_key=pk,
        role=os.environ['SNOWFLAKE_ROLE'],
        database=os.environ['SNOWFLAKE_DATABASE'],
        warehouse=os.environ['SNOWFLAKE_WAREHOUSE'],
        login_timeout=30,
        network_timeout=60,
        session_parameters={
            'QUERY_TAG': 'jarvis-data-skill',
            'STATEMENT_TIMEOUT_IN_SECONDS': '120',
        },
    )

query = '''
  SELECT ...  -- write your query here
'''

for attempt in range(3):
    try:
        conn = connect()
        cur = conn.cursor()
        cur.execute(query)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchmany(500)
        truncated = len(rows) == 500
        print(json.dumps([dict(zip(cols, row)) for row in rows], default=str, indent=2))
        if truncated:
            print('\n⚠️  Results were TRUNCATED at 500 rows. The full result set is larger.')
        conn.close()
        break
    except Exception as e:
        if attempt == 2:
            raise
        time.sleep(2 ** attempt)
SQL_QUERY
```

### Error handling

| Error | Action |
|-------|--------|
| `Object does not exist` | Wrong table path — re-check llm-index and manifest. Do NOT retry with a guessed path |
| `SQL compilation error` | Syntax issue or bad column name — print the error, fix, and retry once |
| Connection errors | Same as metric query error table above |

---

## Step 2C — Definition question

Look up definitions in this order. Stop as soon as you find a match.

**1. Semantic manifest** — authoritative metric definitions from the data team:

```bash
python3 -c "
import json
with open('./data/target/semantic_manifest.json') as f:
    m = json.load(f)
target = 'TERM_TO_LOOK_UP'.lower()
for metric in m.get('metrics', []):
    if target in metric['name'].lower() or target in metric.get('description', '').lower():
        print(f\"METRIC: {metric['name']}\")
        print(f\"  Description: {metric.get('description', '(none)')}\")
        print(f\"  Type: {metric.get('type', '?')}\")
        print()
for sm in m.get('semantic_models', []):
    if target in sm['name'].lower() or target in sm.get('description', '').lower():
        print(f\"MODEL: {sm['name']}\")
        print(f\"  Description: {sm.get('description', '(none)')}\")
        print()
"
```

**2. llm-index** — business definitions, table routing, and KPI calculation notes:

```bash
cat ./data/llm-index.md 2>/dev/null || echo "[llm-index not available]"
```

**3. Fallback** — only if neither source has the answer, use general knowledge about Decentraland metrics. **State clearly:** "This definition is based on general knowledge, not the official Decentraland data documentation."

---

## Step 2D — Export results as CSV (when explicitly requested)

When the user asks for a CSV, a Google Sheet, a downloadable file, or uses phrases like "export", "download", "attach", "upload the data", or "give me the file":

1. Run the query exactly as in Step 2B.
2. Write the results to a CSV at `/tmp/<slug>.csv` where `<slug>` is a short descriptor of the query (e.g. `active_wallets_2026`).
3. Emit an `<upload_file>` tag **at the very end** of your response so the bot uploads it automatically.

### CSV export snippet

Add this block after fetching the rows in Step 2B.3:

```python
import csv, os, hashlib

csv_slug = "query_results"  # replace with a descriptive slug, e.g. "active_wallets_2026"
csv_path = f"/tmp/{csv_slug}.csv"

with open(csv_path, "w", newline="", encoding="utf-8") as csv_file:
    writer = csv.DictWriter(csv_file, fieldnames=cols)
    writer.writeheader()
    writer.writerows([dict(zip(cols, row)) for row in rows])

print(f"[CSV] Written {len(rows)} rows to {csv_path}")
```

### Emitting the upload tag

After your summary text, output the tag on its own line:

```
<upload_file path="/tmp/active_wallets_2026.csv" filename="active_wallets_2026.csv"/>
```

**Rules:**
- The tag must be the very last thing in your response — nothing after it.
- `path` must be the absolute path used in the export snippet above.
- `filename` should be human-readable and include the `.csv` extension.
- Only emit the tag when a file export was explicitly requested. Do **not** attach a CSV for every query.
- Never mention the internal file path in the Slack response text — just say the file is attached.

### Example response with CSV attachment

```
*Active Wallets 2026* — 795 wallets (10+ days active, any client)

Breakdown by year first entered:
• 2021 — 120 wallets, $647K marketplace spend
• 2022 — 100 wallets, $236K
…

The full dataset (795 rows, 6 columns) is attached as a CSV — import it directly into Google Sheets via *File → Import*.

<upload_file path="/tmp/active_wallets_2026.csv" filename="active_wallets_2026.csv"/>
```

---

## Step 3 — Format the response

Responses go to Slack (mrkdwn syntax):
- `*bold*` for metric names and key numbers
- ` ```code``` ` blocks for tabular data (5+ rows)
- Round large numbers: 12,345 → "~12.3K"; 1,234,567 → "~1.2M"
- Always state the date range queried
- Always state which metric or table was used as source

### Interpretation (required for metric and SQL results only)

After presenting the numbers, always add 1–3 sentences of interpretation:
- What does the result mean in business terms?
- Is the number higher, lower, or consistent with typical values? Reference prior context if available in the thread.
- Highlight any notable trend, spike, drop, or anomaly.
- If the result is ambiguous or noisy, say so.

### Edge cases

| Scenario | How to respond |
|----------|---------------|
| Results are empty / all zeros | Say so explicitly: "*DAU for 2026-03-08*: *0 wallets*. No activity was recorded for this date." |
| Results were truncated (500-row limit) | Mention it and offer to narrow the query |
| Multiple metrics requested | Summarize in a comparison table. Include WoW or MoM changes when data allows |
| Trend data (range of dates) | Describe the trend direction: "DAU rose from ~1.8K to ~2.3K over the period (+28%)." |
| Metric returned but uncertain it's the right one | State which metric was used and why, so the user can correct |
| User shared a Metabase URL | Extract the question ID from the URL and look it up in `exposures.yml` (Step 2B.1). If found: query the backing dbt model directly and state which one was used — "This chart uses `[model]`, querying it directly. Note: I can't reproduce Metabase's exact filters or transformations." If not found: "I couldn't find this chart in the model registry — querying Snowflake based on your question. Results may differ." |
| A result corrects a previous one in the same thread | Explain the cause explicitly: "The previous number used `[table X]`; this one uses `[table Y]` because `[reason]`." Never describe the change as "slightly revised" without the reason. |

### Example responses

**Single metric:**
> *DAU for 2026-03-08*: *2,341 wallets*
> Includes Explorer + Marketplace + Scene activity; bots excluded.
> Source: `metric: active_wallets_daily`

**Trend:**
> *DAU, last 7 days (Mar 2–8):*
> ```
> Mar 02: 1,823
> Mar 03: 1,912
> Mar 08: 2,341
> ```
> Trend: +28% WoW. Source: `metric: active_wallets_daily`

**No data:**
> *MAU for January 2024*: No data available.
> Metric data begins in 2025. Try a date range from 2025 onward.

**Definition:**
> *D7 retention* measures the share of new wallets that return at least once within 7 days of their first session.
> Source: semantic manifest → `retention_d7`

---

## Data Quality Alerts

If you detect a data quality issue during a query — including but not limited to:
- A field that is documented as unreliable (e.g. `DIM_SCENES.SDK_VERSION`)
- Results that contradict reasonable expectations (e.g. 96% of users on a 6-year-old OS version)
- Unexpected NULLs or zeros where data should exist
- A fallback/default value dominating the results (suggesting a broken upstream field)

Then **always** include this line at the top of your response, before any data:

> ⚠️ *Data quality issue detected* — <!subteam^S0APRDQS8UD> this may need a fix in the warehouse: [one-line description of the issue]

Then explain the issue and answer the question as best you can with the caveat. Do not suppress the alert even if you can still answer partially.

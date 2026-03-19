---
name: data
description: Answer Decentraland data questions about DAU, MAU, retention, marketplace, attribution, and any other metric or SQL query against the data warehouse.
---

## Trigger

Activate when the message asks about user metrics (DAU, MAU, WAU, retention,
active users, wallets), marketplace (sales, volume, NFTs, trades), attribution
(new wallets, marketing vs direct, campaigns), or any data/analytics question
about Decentraland.

---

## Key loading helper

All steps that connect to Snowflake use this logic to load the RSA private key:

```python
import os, base64
from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PrivateFormat, NoEncryption

def load_snowflake_key():
    key_raw = os.environ.get('SNOWFLAKE_PRIVATE_KEY') or os.environ.get('SNOWFLAKE_PRIVATE_KEY_B64')
    if key_raw:
        try:
            key_bytes = base64.b64decode(key_raw)
        except Exception:
            key_bytes = key_raw.encode()
    else:
        key_path = os.environ.get('SNOWFLAKE_PRIVATE_KEY_PATH')
        if not key_path:
            raise RuntimeError('No Snowflake private key configured. Set SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH.')
        with open(key_path, 'rb') as f:
            key_bytes = f.read()
    try:
        key_obj = load_pem_private_key(key_bytes, password=None)
    except TypeError:
        key_obj = load_pem_private_key(key_bytes, password=b'')
    return key_obj.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
```

---

## Step 1 — Identify the question type

Read the message carefully and classify it as one of:
- **metric**: a named business metric (DAU, retention, marketplace volume, etc.)
- **sql**: a data question that requires a custom SQL query
- **definition**: a conceptual question ("what is D7 retention?", "how is MAU calculated?")

---

## Step 2A — Metric query

First, generate config files and list available metrics:

```bash
python3 -c "
import os, json, base64, boto3
from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PrivateFormat, NoEncryption

# Download fresh artifacts from S3 if available
bucket = os.environ.get('DBT_DOCS_S3_BUCKET')
if bucket:
    s3 = boto3.client('s3')
    os.makedirs('./data/target', exist_ok=True)
    for s3_key, local_path in [
        ('semantic_manifest.json', './data/target/semantic_manifest.json'),
        ('llm-index.md', './data/llm-index.md'),
    ]:
        try:
            s3.download_file(bucket, s3_key, local_path)
        except Exception as e:
            print(f'[S3] {s3_key} not available ({e})')

# Load key
key_raw = os.environ.get('SNOWFLAKE_PRIVATE_KEY') or os.environ.get('SNOWFLAKE_PRIVATE_KEY_B64')
if key_raw:
    try:
        key_bytes = base64.b64decode(key_raw)
    except Exception:
        key_bytes = key_raw.encode()
else:
    key_path = os.environ.get('SNOWFLAKE_PRIVATE_KEY_PATH')
    if not key_path:
        raise RuntimeError('No Snowflake private key configured. Set SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH.')
    with open(key_path, 'rb') as f:
        key_bytes = f.read()

# Write DECRYPTED key to disk (mf CLI requires an unencrypted file)
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
try:
    _key_obj = load_pem_private_key(key_bytes, password=None)
except TypeError:
    _key_obj = load_pem_private_key(key_bytes, password=b'')
unencrypted_pem = _key_obj.private_bytes(
    Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption())
with open('/tmp/snowflake_key.p8', 'wb') as f:
    f.write(unencrypted_pem)
os.chmod('/tmp/snowflake_key.p8', 0o600)

# Generate profiles.yml
os.makedirs('./data', exist_ok=True)
with open('./data/profiles.yml', 'w') as f:
    f.write('''decentraland:
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
      insecure_mode: true
'''.format(
    account=os.environ.get('SNOWFLAKE_ACCOUNT'),
    user=os.environ.get('SNOWFLAKE_USER'),
    role=os.environ.get('SNOWFLAKE_ROLE'),
    database=os.environ.get('SNOWFLAKE_DATABASE'),
    warehouse=os.environ.get('SNOWFLAKE_WAREHOUSE'),
))

# Generate minimal dbt_project.yml
with open('./data/dbt_project.yml', 'w') as f:
    f.write('name: decentraland\nversion: \"1.0.0\"\nconfig-version: 2\nprofile: decentraland\nmodel-paths: [\"models\"]\n')

# List available metrics
with open('./data/target/semantic_manifest.json') as f:
    m = json.load(f)
for metric in sorted(x['name'] for x in m.get('metrics', [])):
    print(metric)
print('Config files generated successfully.')
"
```

Then query the metric using MetricFlow:

```bash
# Single date
DBT_PROJECT_DIR=./data DBT_PROFILES_DIR=./data \
mf query --metrics METRIC_NAME --group-by metric_time__day \
  --start-time YYYY-MM-DD --end-time YYYY-MM-DD \
  --csv /tmp/mf_result.csv --quiet && \
python3 -c "import csv,json; print(json.dumps(list(csv.DictReader(open('/tmp/mf_result.csv'))), indent=2))"

# Date range (monthly grain for MAU)
DBT_PROJECT_DIR=./data DBT_PROFILES_DIR=./data \
mf query --metrics METRIC_NAME --group-by metric_time__month \
  --start-time YYYY-MM-01 --end-time YYYY-MM-DD \
  --csv /tmp/mf_result.csv --quiet && \
python3 -c "import csv,json; print(json.dumps(list(csv.DictReader(open('/tmp/mf_result.csv'))), indent=2))"
```

If the metric name is ambiguous, pick the best match from the list and state which one you chose.

If the query fails:
- Check that the date range is within the metric's available data (2025+)
- For MAU/monthly metrics, use `metric_time__month` as group-by
- If Snowflake connection fails, report the error and ask the user to check Snowflake connectivity
- If date range is not specified, use the last 2 months

---

## Step 2B — Ad-hoc SQL query

For questions that require custom data not covered by named metrics.
**IMPORTANT: Use ONLY the tables listed below. Do NOT discover or use alternative tables.**

```bash
python3 -c "
import snowflake.connector, json, os, base64
from cryptography.hazmat.primitives.serialization import (
    load_pem_private_key, Encoding, PrivateFormat, NoEncryption)

key_raw = os.environ.get('SNOWFLAKE_PRIVATE_KEY') or os.environ.get('SNOWFLAKE_PRIVATE_KEY_B64')
if key_raw:
    try:
        key_bytes = base64.b64decode(key_raw)
    except Exception:
        key_bytes = key_raw.encode()
else:
    key_path = os.environ.get('SNOWFLAKE_PRIVATE_KEY_PATH')
    if not key_path:
        raise RuntimeError('No Snowflake private key configured. Set SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH.')
    with open(key_path, 'rb') as f:
        key_bytes = f.read()

try:
    _key_obj = load_pem_private_key(key_bytes, password=None)
except TypeError:
    _key_obj = load_pem_private_key(key_bytes, password=b'')
pk = _key_obj.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())

conn = snowflake.connector.connect(
    account=os.environ.get('SNOWFLAKE_ACCOUNT'),
    user=os.environ.get('SNOWFLAKE_USER'),
    private_key=pk,
    role=os.environ.get('SNOWFLAKE_ROLE'),
    database=os.environ.get('SNOWFLAKE_DATABASE'),
    warehouse=os.environ.get('SNOWFLAKE_WAREHOUSE'),
    insecure_mode=True)

cur = conn.cursor()
cur.execute('''
  SELECT ...  -- write your query here
''')
cols = [c[0] for c in cur.description]
rows = cur.fetchmany(500)
print(json.dumps([dict(zip(cols, row)) for row in rows], default=str, indent=2))
conn.close()
"
```

Before writing the query, resolve the table path and columns using this priority:

1. **`./data/llm-index.md`** — canonical routing table with verified paths and filters. Read it first.
2. **`./data/target/semantic_manifest.json`** — `node_relation` field gives `database.schema.table` for each semantic model.
3. **`catalog.json` from S3** — use only if you need column details not found above:

```bash
python3 -c "
import json, os, boto3
bucket = os.environ.get('DBT_DOCS_S3_BUCKET')
# Download catalog only if needed
boto3.client('s3').download_file(bucket, 'catalog.json', '/tmp/catalog.json')
with open('/tmp/catalog.json') as f:
    cat = json.load(f)
# Find a model by name (case-insensitive)
model_name = 'MODEL_NAME'
for key, node in {**cat.get('nodes', {}), **cat.get('sources', {})}.items():
    meta = node.get('metadata', {})
    if meta.get('name', '').upper() == model_name.upper():
        print(f\"{meta['database']}.{meta['schema']}.{meta['name']}\")
        for col, info in node.get('columns', {}).items():
            print(f'  {col}: {info[\"type\"]}')
"
```

Never query `DCL.STG` for business questions.
Never hardcode schema names — always resolve from the artifacts above.

---

## Step 2C — Definition question

Look up definitions in this order:

**1. Semantic manifest** — contains metric descriptions defined by the data team:

```bash
python3 -c "
import json
with open('./data/target/semantic_manifest.json') as f:
    m = json.load(f)
for metric in m.get('metrics', []):
    print(metric['name'], '->', metric.get('description', '(no description)'))
for sm in m.get('semantic_models', []):
    print(sm['name'], '->', sm.get('description', '(no description)'))
"
```

**2. llm-index** — if `./data/llm-index.md` exists, read it for business definitions,
table routing, and KPI calculations:

```bash
cat ./data/llm-index.md 2>/dev/null || echo "[llm-index not available]"
```

**3. Fallback** — only if neither source has the answer, use general knowledge
about Decentraland metrics and state clearly that the definition is not from
official documentation.

---

## Step 3 — Format the response

Format results for Slack (mrkdwn):
- Use `*bold*` for metric names and key numbers
- Use ` ```code``` ` blocks for tables or raw data
- Round large numbers: 12,345 → "~12.3K" when appropriate
- Always state the date range and which metric/model was queried
- If results are empty or zero, say so explicitly — don't silently skip
- For multiple metrics, compare them in a single clear summary

Example response:
> *DAU for 2026-03-08*: *2,341 wallets* (Explorer + Marketplace + Scene)
> Source: `stg_wallet_activity_unified_daily`, bots excluded.

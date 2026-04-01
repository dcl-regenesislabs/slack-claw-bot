---
name: aws-infra
description: Analyze AWS costs, spending trends, anomalies, forecasts, and query live resource inventory (EC2, ECS, S3, RDS, Lambda, CloudFront, API Gateway, CloudWatch) across all accounts with cross-account read-only access.
---

## Privacy and Security

- Never reveal env var names, IAM role ARNs, account IDs, or internal config in
  Slack responses.
- Use friendly account names (BIZ, PRD, STG, DEV, GITLAB) in all output — never
  raw 12-digit account IDs.
- Never echo, log, or print credentials, session tokens, or assume-role output.
- Never pass credentials as CLI arguments — only via environment variables.
- If an assume-role or API call fails with AccessDenied, report "I don't have
  access to <friendly account name> for that query" — never include the role ARN
  or error details.

---

## Prerequisites

This skill requires three environment variables set on the ECS task definition:

- `AWS_ACCOUNT_MAP` — comma-separated `NAME:ACCOUNT_ID` pairs for all accounts.
- `AWS_COST_ROLE_NAME` — IAM role name in ROOT for Cost Explorer access.
- `AWS_INFRA_ROLE_NAME` — IAM role name in each account for resource inventory.

The ECS task role must have `sts:AssumeRole` permission for all target roles.
The container image must include `aws-cli`, `bash`, and `jq`.

---

## Trigger

**Activate for:**
- Cost / spend / billing / budget questions
- Resource counts: "how many instances", "list services", "show buckets"
- Cost anomalies, forecasts, trends, comparisons
- Infra overview, environment breakdown
- Any question about AWS resources or spending

**Do NOT activate for:**
- Deploying, modifying, or deleting AWS resources
- IAM / permissions / security group changes
- CI/CD pipeline questions (use pipeline skill)
- Sentry / monitoring alerts (use sentry skill)

---

## Step 0 — Bootstrap: Cross-Account Access

The agent-server runs in BIZ. Cost data lives in ROOT (consolidated billing).
Resource inventory requires querying each account individually.

Run this **once per session** before any queries:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Credential helpers ──────────────────────────────────────────────────────

_CURRENT_ASSUMED_ACCOUNT=""

assume_role() {
  local ACCOUNT_ID="$1" ROLE_NAME="$2"

  # Skip if already assumed into this account+role
  if [ "$_CURRENT_ASSUMED_ACCOUNT" = "${ACCOUNT_ID}:${ROLE_NAME}" ]; then
    return 0
  fi

  # Always clear previous credentials first
  clear_assumed_role

  local CREDS
  if ! CREDS=$(aws sts assume-role \
    --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}" \
    --role-session-name "agent-infra-$(date -u +%s)" \
    --duration-seconds 900 \
    --output json 2>/dev/null); then
    echo "[ERROR] Cannot access this account" >&2
    _CURRENT_ASSUMED_ACCOUNT=""
    return 1
  fi

  export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | jq -r '.Credentials.AccessKeyId')
  export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | jq -r '.Credentials.SecretAccessKey')
  export AWS_SESSION_TOKEN=$(echo "$CREDS" | jq -r '.Credentials.SessionToken')
  _CURRENT_ASSUMED_ACCOUNT="${ACCOUNT_ID}:${ROLE_NAME}"

  # Validate credentials work
  if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
    echo "[ERROR] Assumed credentials are invalid" >&2
    clear_assumed_role
    return 1
  fi
}

clear_assumed_role() {
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  _CURRENT_ASSUMED_ACCOUNT=""
}

# ── Account map ─────────────────────────────────────────────────────────────

declare -A ACCOUNTS
IFS=',' read -ra PAIRS <<< "$AWS_ACCOUNT_MAP"
for pair in "${PAIRS[@]}"; do
  IFS=':' read -r name id <<< "$pair"
  ACCOUNTS[$name]=$id
done

# Reverse map for friendly names
declare -A ACCOUNT_NAMES
for name in "${!ACCOUNTS[@]}"; do
  ACCOUNT_NAMES[${ACCOUNTS[$name]}]=$name
done

echo "[OK] Bootstrap complete. Accounts: ${!ACCOUNTS[*]}"
```

Session names include a unix timestamp (`agent-infra-<epoch>`) for CloudTrail
auditability — filter by `userIdentity.arn:*agent-infra-*` to audit all queries.

---

## Step 1 — Classify and Plan Queries

Before running any AWS commands, classify the request and plan the **minimum
set of API calls** needed.

### Efficiency principles

1. **Narrow the scope first.** If the user asks about a specific account or
   service, only query that account/service — never iterate all accounts
   "just in case."
2. **Cost Explorer answers "how much"; inventory answers "how many/what."**
   Don't pull inventory when the user only asks about spend, and vice versa.
   Combine only when the question requires correlation.
3. **Reuse assumed sessions.** The helper skips STS if already assumed into
   the target account. When querying multiple services in the same account,
   batch all queries before moving to the next account.
4. **Server-side filtering.** Always use `--filter` in Cost Explorer and
   `--filters`/`--query` (JMESPath) in describe calls to reduce payload.
   Never fetch all data and filter client-side when the API supports filtering.
5. **Prefer single-call patterns.** For trends, use one `get-cost-and-usage`
   call with DAILY granularity spanning both periods, then aggregate —
   one API call instead of two.
6. **Respect API rate limits.** Cost Explorer allows 5 requests/sec. Add a
   1-second sleep between Cost Explorer calls if issuing more than 3 in
   sequence.
7. **Cap results.** Default to top 10 items sorted by cost descending. Only
   fetch more if the user explicitly asks.
8. **Avoid CloudWatch unless explicitly asked.** Metric queries are expensive
   (per-metric, per-instance). Only call CloudWatch when the user asks about
   utilization, performance, or waste — never as part of a general overview.

### Request classification

| Type | Cost Explorer (ROOT) | Inventory (per-account) | Combined |
|------|:-------------------:|:----------------------:|:--------:|
| "How much are we spending?" | yes | | |
| "What's costing us the most?" | yes | | |
| "Top resources by cost?" | yes (group by tag:Name) | | |
| "ECS costs per service?" | yes (Fargate tags) | | |
| "This month vs last?" | yes (single DAILY call) | | |
| "Any anomalies?" | yes (get-anomalies) | | |
| "Forecast?" | yes (get-cost-forecast) | | |
| "How many EC2 in PRD?" | | yes (PRD only) | |
| "What's running in STG?" | | yes (STG only) | |
| "Why is PRD expensive?" | yes | yes (PRD only) | yes |
| "Full environment overview" | yes | yes (all accounts) | yes |
| "Drill down S3 costs" | yes (group by API Operation) | | |

### API Operation drill-down

Cost Explorer supports `DIMENSION Key=OPERATION` to break down a service's
cost by API operation (e.g., S3 GetObject vs PutObject vs DataTransfer, or
EC2 RunInstances vs NatGateway). This is a **second-level drill-down only** —
never include it in initial responses. Use it when:
- The user explicitly asks to drill down or understand *why* a service costs
  what it does
- A service shows an unexpected cost spike and the user wants to investigate
- The user asks about data transfer, API call volume, or operation-level detail

Always filter to a single SERVICE first, then group by OPERATION:

```bash
aws ce get-cost-and-usage \
  --time-period Start=$START,End=$END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Simple Storage Service"]}}' \
  --group-by Type=DIMENSION,Key=OPERATION \
  --output json \
| jq '[.ResultsByTime[0].Groups[] | {Operation: .Keys[0], Cost: (.Metrics.UnblendedCost.Amount | tonumber)} | select(.Cost > 0.01)] | sort_by(-.Cost) | .[:10]'
```

This reveals insights like data transfer dominating S3 costs, or NatGateway
being the real driver behind EC2 spend — things invisible at the service level.

---

## Step 2 — Cost Explorer Queries (ROOT Account)

```bash
assume_role "${ACCOUNTS[ROOT]}" "$AWS_COST_ROLE_NAME"
```

All Cost Explorer queries use `--output json` and pipe through `jq`.
Always use `UnblendedCost` unless the user explicitly asks for amortized or blended.

### Summary — current month MTD

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --output json \
| jq -r '.ResultsByTime[0].Total.UnblendedCost.Amount'
```

### Summary — previous month

```bash
PREV_START=$(date -u -v-1m +%Y-%m-01 2>/dev/null || date -u -d "last month" +%Y-%m-01)
CURR_START=$(date -u +%Y-%m-01)
aws ce get-cost-and-usage \
  --time-period Start=$PREV_START,End=$CURR_START \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --output json
```

### Breakdown by service

```bash
aws ce get-cost-and-usage \
  --time-period Start=$START,End=$END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --output json \
| jq '[.ResultsByTime[0].Groups[] | {Service: .Keys[0], Cost: (.Metrics.UnblendedCost.Amount | tonumber)}] | sort_by(-.Cost) | .[:10]'
```

### Breakdown by tag:Name

```bash
aws ce get-cost-and-usage \
  --time-period Start=$START,End=$END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=TAG,Key=Name \
  --output json \
| jq '[.ResultsByTime[0].Groups[] | {Name: .Keys[0], Cost: (.Metrics.UnblendedCost.Amount | tonumber)} | select(.Cost > 0.01)] | sort_by(-.Cost) | .[:10]'
```

### Breakdown by account (environment)

```bash
aws ce get-cost-and-usage \
  --time-period Start=$START,End=$END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=LINKED_ACCOUNT \
  --output json
```

Map account IDs to friendly names using the `ACCOUNT_NAMES` associative array.

### Fargate — by ECS service name

```bash
aws ce get-cost-and-usage \
  --time-period Start=$START,End=$END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Elastic Container Service"]}}' \
  --group-by Type=TAG,Key=aws:ecs:serviceName \
  --output json \
| jq '[.ResultsByTime[0].Groups[] | {Service: .Keys[0], Cost: (.Metrics.UnblendedCost.Amount | tonumber)} | select(.Cost > 0.01)] | sort_by(-.Cost) | .[:10]'
```

There is only one ECS cluster per environment, so grouping by cluster is not
useful. Always group by `aws:ecs:serviceName` for Fargate cost breakdowns.

### Trend — month-over-month (single API call)

Use DAILY granularity spanning both months in one request, then aggregate:

```bash
PREV_START=$(date -u -v-1m +%Y-%m-01 2>/dev/null || date -u -d "last month" +%Y-%m-01)
TODAY=$(date -u +%Y-%m-%d)
aws ce get-cost-and-usage \
  --time-period Start=$PREV_START,End=$TODAY \
  --granularity DAILY \
  --metrics UnblendedCost \
  --output json \
| jq '
  [.ResultsByTime[] | {date: .TimePeriod.Start, cost: (.Total.UnblendedCost.Amount | tonumber)}]
  | group_by(.date[:7])
  | map({month: .[0].date[:7], total: (map(.cost) | add)})
'
```

Compute delta and % change from the two month objects.

### Anomaly detection

```bash
THIRTY_AGO=$(date -u -v-30d +%Y-%m-%d 2>/dev/null || date -u -d "30 days ago" +%Y-%m-%d)
aws ce get-anomalies \
  --date-interval Start=$THIRTY_AGO,End=$(date -u +%Y-%m-%d) \
  --max-results 10 \
  --output json \
| jq '[.Anomalies[] | {
    Service: .RootCauses[0].Service,
    Region: .RootCauses[0].Region,
    Account: .RootCauses[0].LinkedAccount,
    Expected: .Impact.MaxExpectedImpact,
    Actual: .Impact.TotalActualSpend,
    Severity: .AnomalyScore.MaxScore
  }]'
```

Map `.Account` to friendly names before outputting.

### Forecast

```bash
TOMORROW=$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d "tomorrow" +%Y-%m-%d)
NEXT_MONTH=$(date -u -v+1m +%Y-%m-01 2>/dev/null || date -u -d "next month" +%Y-%m-01)
aws ce get-cost-forecast \
  --time-period Start=$TOMORROW,End=$NEXT_MONTH \
  --granularity MONTHLY \
  --metric UNBLENDED_COST \
  --output json \
| jq '{Forecast: .Total.Amount, Lower: .Total.PredictionIntervalLowerBound, Upper: .Total.PredictionIntervalUpperBound}'
```

---

## Step 3 — Resource Inventory Queries (Per-Account)

### Ordering for efficiency

When querying multiple accounts, batch all needed services per account before
switching:

```
assume_role PRD -> EC2 + ECS + RDS + ...  (all PRD queries)
assume_role STG -> EC2 + ECS + RDS + ...  (all STG queries)
```

Never zigzag between accounts — each unnecessary assume-role is an STS API
call + network round-trip.

### Graceful degradation

If assume-role fails for one account, log a warning and continue with the
others. Never abort the entire response because one account is unreachable.

```bash
if ! assume_role "${ACCOUNTS[PRD]}" "$AWS_INFRA_ROLE_NAME"; then
  echo "[WARN] Skipping PRD — access denied"
  # continue to next account
fi
```

Report skipped accounts in the Slack response:
> _Could not access DEV — results may be incomplete._

### EC2 — running instances

```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].{Id:InstanceId,Type:InstanceType,Name:Tags[?Key==`Name`]|[0].Value,AZ:Placement.AvailabilityZone,Launch:LaunchTime}' \
  --output json
```

### ECS — clusters, services, running tasks

```bash
CLUSTERS=$(aws ecs list-clusters --query 'clusterArns[]' --output text)
for cluster in $CLUSTERS; do
  CLUSTER_NAME="${cluster##*/}"
  echo "=== Cluster: $CLUSTER_NAME ==="
  # list-services paginates automatically (default page size: 10)
  SVCS=$(aws ecs list-services --cluster "$cluster" --query 'serviceArns[]' --output text)
  [ -z "$SVCS" ] && continue
  echo "$SVCS" | tr '\t' '\n' | xargs -n 10 aws ecs describe-services \
    --cluster "$cluster" --services \
    --query 'services[].{Name:serviceName,Running:runningCount,Desired:desiredCount,Status:status}' \
    --output json
done
```

AWS CLI auto-paginates by default — do NOT pass `--max-items`, `--no-paginate`,
or `--page-size` unless you have a specific reason. The CLI handles `nextToken`
internally and merges all pages. `xargs -n 10` batches describe-services
(API limit: 10 per call).

### S3 — buckets

```bash
aws s3api list-buckets \
  --query 'Buckets[].{Name:Name,Created:CreationDate}' \
  --output json
```

Do NOT call `get-bucket-tagging` for every bucket by default — that's N+1
API calls. Only fetch tags for specific buckets if the user asks.

### RDS — instances

```bash
aws rds describe-db-instances \
  --query 'DBInstances[].{Id:DBInstanceIdentifier,Class:DBInstanceClass,Engine:Engine,StorageGB:AllocatedStorage,MultiAZ:MultiAZ,Status:DBInstanceStatus}' \
  --output json
```

### Lambda — functions

```bash
aws lambda list-functions \
  --query 'Functions[].{Name:FunctionName,Runtime:Runtime,MemoryMB:MemorySize,TimeoutSec:Timeout}' \
  --output json
```

### CloudFront — distributions

```bash
aws cloudfront list-distributions \
  --query 'DistributionList.Items[].{Id:Id,Domain:DomainName,Alias:Aliases.Items[0],Status:Status}' \
  --output json
```

### API Gateway — REST APIs

```bash
aws apigateway get-rest-apis \
  --query 'items[].{Name:name,Id:id}' \
  --output json
```

### CloudWatch — on-demand only

Only call when user explicitly asks about utilization, performance, or idle
resources. Always scope to a single resource and a specific metric:

```bash
aws cloudwatch get-metric-statistics \
  --namespace <namespace> --metric-name <metric> \
  --dimensions Name=<dim>,Value=<value> \
  --start-time <start> --end-time <end> \
  --period 86400 --statistics Average \
  --output json
```

Common use cases:
- EC2 CPU: `AWS/EC2` / `CPUUtilization` / `InstanceId`
- RDS CPU: `AWS/RDS` / `CPUUtilization` / `DBInstanceIdentifier`
- Lambda invocations: `AWS/Lambda` / `Invocations` / `FunctionName`
- Lambda errors: `AWS/Lambda` / `Errors` / `FunctionName`

---

## Step 4 — Correlate and Present

When answering combined questions:
1. Query cost data first (ROOT) to identify top spenders
2. Query inventory on the relevant account(s) to show what's behind the cost
3. Present both together

### Output formatting

- Use Slack mrkdwn (NOT GitHub markdown)
- Round costs to 2 decimal places, USD
- Use `*bold*` for section headers
- Use monospace blocks for tables/alignment
- Always state the time period and note "Cost data is ~24h delayed; inventory is real-time"
- Default to top 10 items sorted by cost descending
- Map account IDs to friendly names (BIZ, PRD, STG, DEV, GITLAB)
- Show both absolute and relative values for breakdowns
- Flag anything >15% above the previous period with a warning marker

### Example combined output

```
*AWS Costs + Infra — March 2026 (MTD as of Mar 30)*
_Cost data ~24h delayed - inventory is real-time_

*Spend by Environment:*
  PRD      $12,450.32  (58%)   up 4% vs Feb
  BIZ       $4,210.18  (20%)   down 2% vs Feb
  STG       $2,890.45  (14%)   flat
  DEV       $1,205.60   (6%)   up 12% vs Feb (!)
  GITLAB      $430.12   (2%)   flat
  *Total:  $21,186.67*         Forecast: $23,800 +/- $800

*PRD — Top Services:*
  ECS Fargate   $5,230  — 34 services, 89 tasks
  RDS           $3,100  — 4 instances (2x r6g.xl, 2x t3.med)
  EC2           $1,850  — 7 running (3x m5.xl, 2x t3.lg, 2x t3.med)
  CloudFront    $1,200  — 3 distributions
  S3              $620  — 42 buckets
  Lambda          $280  — 23 functions, 1.2M invocations/mo

*DEV +12%* — 2 new EC2 instances since Mar 14 (+$120)
```

### Response length

- Simple queries (spend total, one-service breakdown): 5-10 lines
- Environment overview: 15-25 lines
- Full multi-account + inventory: cap at 40 lines, offer to drill down
- If response would exceed Slack's limit, summarize top-level and offer
  "want me to break down <service/account>?"

---

## Step 5 — Security Guardrails

### Read-only enforcement

This skill MUST NOT run any command that modifies AWS state.

**Never run:**
- Any `create-*`, `delete-*`, `modify-*`, `update-*`, `put-*`, `start-*`,
  `stop-*`, `terminate-*`, `reboot-*` AWS CLI subcommand
- Any `aws iam` command whatsoever
- Any `aws sts` command other than `assume-role` and `get-caller-identity`
- `aws s3 cp`, `aws s3 mv`, `aws s3 rm`, `aws s3 sync`, or any S3 write
- `aws ec2 run-instances`, `terminate-instances`, `stop-instances`
- `aws ecs update-service`, `delete-service`, `create-service`
- `aws rds delete-db-instance`, `modify-db-instance`
- `aws lambda update-function-*`, `delete-function`, `invoke`

**Allowed patterns — complete allowlist:**
- `aws ce get-*` — Cost Explorer read
- `aws budgets describe-*` — Budgets read
- `aws organizations list-*`, `aws organizations describe-*` — Org read
- `aws ec2 describe-*` — EC2 read
- `aws ecs list-*`, `aws ecs describe-*` — ECS read
- `aws s3api list-*`, `aws s3api get-bucket-*` — S3 read
- `aws rds describe-*`, `aws rds list-*` — RDS read
- `aws lambda list-*`, `aws lambda get-*` — Lambda read
- `aws cloudfront list-*`, `aws cloudfront get-*` — CloudFront read
- `aws apigateway get-*` — API Gateway read
- `aws cloudwatch get-metric-*`, `aws cloudwatch list-*`,
  `aws cloudwatch describe-alarms` — CloudWatch read
- `aws tag get-*` — Resource Groups Tagging read
- `aws sts assume-role`, `aws sts get-caller-identity` — STS session management

If a user asks to change, stop, or delete a resource, or if your analysis
reveals an optimization or fix that requires infrastructure changes:
- Explain that this skill is read-only and cannot make changes.
- Never provide ready-to-run AWS CLI commands for write operations.
- Recommend the user validate the findings with the DevOps team in
  <#CBK9GC5FY|devops-infra> before any action is taken.
- Only the DevOps team has write permissions on AWS infrastructure.

### Recommendation principles — DevOps before cost

When suggesting optimizations, always apply DevOps best practices first and
cost reduction second. Never recommend the cheapest option if it compromises
observability, reliability, or environment parity. Specifically:

- **Never recommend disabling observability outright.** Monitoring, logging,
  and tracing exist for a reason. Instead of "disable X", recommend reducing
  resolution, retention, or scope. For example: switch from enhanced (1-min)
  to standard (5-min) Container Insights, reduce log retention to 7-14 days
  in non-prod, or enable metrics selectively on active services only.
- **Respect environment parity.** If PRD has a capability (Container Insights,
  log groups, alarms), non-prod should too — but proportional to usage, not
  a full mirror. The principle is: non-prod observability should be
  proportional to non-prod traffic and usage.
- **Prefer tuning over removing.** Reduce granularity, shorten retention,
  filter noisy endpoints, drop per-task metrics in favor of per-service
  aggregates. These preserve the safety net while cutting cost.
- **Always present the middle ground first.** Lead with the balanced option
  that preserves best practices, then mention the aggressive option as an
  alternative with its tradeoffs clearly stated. Never lead with "just
  disable it" — even if the user asks for maximum savings.
- **Flag operational risk.** If a cost-saving action reduces incident
  detection capability, debugging visibility, or recovery speed, say so
  explicitly. Example: "Disabling CI on STG saves $144/month but removes
  the ability to catch memory leaks before PRD."
- **Log retention is not optional.** Every log group should have a retention
  policy. Infinite retention is waste, not caution. Recommend 30 days for
  PRD, 7-14 days for non-prod as defaults, longer only if compliance
  requires it.

### Credential hygiene

- Always call `clear_assumed_role` after completing all queries for a response
- Never store credentials in files or include them in Slack output
- The `--role-session-name` includes a timestamp for CloudTrail audit

### Input validation

- If the user provides an account name not in `AWS_ACCOUNT_MAP`, respond with
  the list of available environment names — never attempt to guess account IDs
- If a date range exceeds 12 months, warn and cap to 12 months (Cost Explorer
  limit)
- Sanitize any user-provided values before passing to `--filter` — never
  interpolate raw Slack input into JSON filter strings without escaping

---

## Step 6 — Error Handling

| Error | Action |
|-------|--------|
| AssumeRole AccessDenied | Skip account, warn in output, continue with others |
| Cost Explorer ThrottlingException | Wait 2s, retry once; if still throttled, report partial results |
| Cost Explorer DataUnavailableException | Report "Cost data not yet available for this period" |
| Empty results (no groups) | Report "No data for this filter/period" — don't return blank |
| CLI timeout (>15s per call) | Kill and report "Query timed out for <service>" |
| Invalid date range | Explain the valid range and ask user to rephrase |

Always return *something* useful even on partial failure. "Here's what I could
get; these accounts/services had issues" is better than no response.

---

## Step 7 — Query Scope Rules

- If user specifies an environment (e.g., "PRD costs"), query only that account
- If user asks broadly ("total spend"), query ROOT Cost Explorer with account grouping
- If user asks "across all environments", iterate all accounts for inventory
- When iterating accounts, query them sequentially — always `clear_assumed_role`
  between accounts
- Never run inventory on ROOT (org management account, not workloads)
- For Fargate costs: always use `aws:ecs:serviceName` auto-tag, never `tag:Name`
  (there is only one ECS cluster per environment — cluster grouping is not useful)
- For all other resources: use `tag:Name` for cost-to-resource correlation

---

## Step 8 — Tag Coverage Caveats

Many AWS resource tags were added recently. This means:

- A resource that existed before tagging may show cost under the
  `"Name$"` group (empty key) or `"No tag key: Name"` in Cost Explorer for
  historical periods. This does NOT mean the resource was free before — it
  was simply untagged.
- When comparing tagged cost across time periods, the sum of tagged groups
  may be lower for older periods. Always check the untagged / "no tag key"
  group and mention it if it's significant.
- If the user asks "when did resource X start costing us?", the tag appearance
  date is NOT the resource creation date. Clarify: "Cost first appeared under
  this tag on <date>, but the resource may have existed earlier without the tag."
- For the most accurate total cost of a service type (e.g., all ECS), filter
  by `SERVICE` dimension rather than tags — tags may have gaps, but the service
  dimension is always complete.

---

## Step 9 — Authorization Error Reporting

If any API call returns an authorization or access error during the response:

- Do NOT let it silently fail or abort the full response.
- Continue with all other queries that do work.
- At the end of the response, add a short note:

```
_Note: some queries could not complete due to missing permissions:_
_- <friendly account name>: <service> — access denied (likely missing <permission hint>)_
```

For example:
```
_Note: could not query CloudFront in GITLAB — access denied (likely missing cloudfront:List* permission on InfraReader-AgentServer role)_
```

Keep it to one line per failed call. This helps the infra team know exactly
what to fix without exposing sensitive role ARNs or account IDs.

---

## Step 10 — Lessons Learned: Query Optimization

These are hard-won patterns for getting accurate results while minimizing API
calls, data transfer, and token consumption.

### Cost Explorer

- **Use MONTHLY granularity when possible.** DAILY returns up to 31x more data
  points. Only use DAILY when you need day-level trends or are comparing partial
  months (the single-call trend pattern in Step 2).
- **Always use jq server-side-style filtering.** Pipe `| jq '...'` immediately
  after the AWS CLI call. Never store full JSON in a variable and process later
  — the payloads can be large and waste tokens.
- **Group by one dimension at a time.** Cost Explorer supports max 2 group-by
  keys, but combining them produces a cartesian product that explodes result
  size. Prefer one group-by per call and correlate manually if needed.
- **Filter before grouping.** Always apply `--filter` to narrow the dataset
  before `--group-by`. For example, filter to ECS service first, then group by
  `aws:ecs:serviceName` — don't group all services and filter client-side.
- **Prefer SERVICE dimension over tags for totals.** The SERVICE dimension is
  always complete and accurate. Tags may have coverage gaps (see Step 8). Use
  tags for drill-down, not for totals.
- **Date ranges: Cost Explorer End date is exclusive.** `End=2026-03-31` means
  data up to and including March 30. To get the full month of March, use
  `End=2026-04-01`.

### Resource Inventory

- **Let the AWS CLI auto-paginate.** The CLI follows `nextToken` automatically
  and merges all pages into a single result. Do NOT pass `--no-paginate`,
  `--max-items`, or manually handle `--next-token` unless you have a specific
  reason (e.g., streaming very large result sets). A missing pagination loop
  silently drops results — this is a data correctness bug, not a performance
  issue. Known low page sizes: `ecs list-services` (10), `lambda list-functions`
  (50), `logs describe-log-groups` (50), `apigateway get-rest-apis` (25).
  The CLI handles all of these transparently.
- **Use `--query` (JMESPath) aggressively.** This filters on the AWS API side,
  reducing response size before it hits the network. Always project only the
  fields you need rather than returning full resource descriptions.
- **Avoid N+1 patterns.** Never loop over a list and make one API call per
  item (e.g., get-bucket-tagging per bucket, describe-instances per instance).
  Use batch APIs where available (describe-services accepts up to 10 ARNs).
- **Count before describe.** If the user only asks "how many", a list call
  with `--query 'length(...)'` is cheaper than a full describe.

### Token Efficiency

- **Don't dump raw JSON into the response.** Parse with jq, extract only what's
  needed, and format as a compact Slack table. Raw Cost Explorer JSON is verbose
  and wastes tokens.
- **Summarize, don't enumerate.** If there are 42 S3 buckets, say "42 buckets"
  — don't list all 42 unless asked.
- **Offer drill-down instead of pre-fetching.** For broad questions, give the
  top-level summary and offer "want me to break down PRD ECS by service?" rather
  than preemptively querying every sub-dimension.

### Data Integrity in Cost Analysis

- **Derive ratios from data — never assume them.** Don't assume how many
  metrics, resources, or series exist per dimension. Always calculate ratios
  by dividing observed totals by observed distinct values. For example, don't
  assume "each ECS service emits ~60 metrics" — query the actual metric count
  and divide by the service count. Assumed ratios compound errors across the
  entire analysis.
- **Cross-validate breakdowns against known totals.** When decomposing a total
  into subcategories (e.g., splitting CW cost by account), verify the parts
  sum back to the whole. If they don't, at least one subquery is wrong. This
  is a cheap sanity check: `sum(parts) vs total → if delta > 5%, investigate`.
- **Verify set differences explicitly.** When identifying orphaned, stale, or
  ghost resources (e.g., "log groups with no active service"), perform a direct
  set comparison between what's active and what's emitting. Never subtract one
  summary count from another — that hides mismatches and produces unreliable
  gap estimates. Query both sets, compare, and list the actual orphans.
- **Separate confirmed facts from derived estimates.** Clearly label which
  numbers come directly from API output (confirmed) and which are calculated
  or inferred (estimated). When a recommendation's projected savings depends
  on a derived number, flag that dependency. Use markers like "confirmed" vs
  "estimated" in the output so the reader knows which figures to trust and
  which to verify independently before acting.

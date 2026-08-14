# HogQL cookbook

Vetted patterns for the `posthog` skill. Each already satisfies the rules in `SKILL.md`: a time bound in the `WHERE` clause, an aggregate, and `LIMIT ≤ 100`. Replace `<event>` / `<prop>` with names you discovered in step 2 — never with a guessed name.

## Taxonomy — what events exist and how busy they are

Use when you don't have a fresh schema cache, or `/event_definitions/` returned 200 with an empty or clearly stale list. Also the taxonomy-only fallback when that endpoint 403s — never as a workaround for a 403 anywhere else.

```sql
SELECT event, count() AS volume, uniq(person_id) AS users, max(timestamp) AS last_seen
FROM events WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY event ORDER BY volume DESC LIMIT 100
```

## Taxonomy — property keys actually present on one event

Use when `/property_definitions/` returned 200 but the list is empty or disagrees with what's really sent — or as the same taxonomy-only 403 fallback described above.

```sql
SELECT arrayJoin(JSONExtractKeys(properties)) AS key, count() AS c
FROM events WHERE event = '<event>' AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY key ORDER BY c DESC LIMIT 100
```

## Cardinality check before breaking a metric down

Use before grouping by a property you've never grouped by — and before caching "known dimension values" (allowed only at ≤ 25 distinct values).

```sql
SELECT properties.<prop> AS v, count() AS c
FROM events WHERE event = '<event>' AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY v ORDER BY c DESC LIMIT 50
```

## Daily active users

Use for "how many users", "DAU", "is usage growing".

```sql
SELECT toStartOfDay(timestamp) AS day, uniq(person_id) AS dau
FROM events WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY day ORDER BY day ASC LIMIT 100
```

## Breakdown of one event by one property

Use for "top X by Y", "which ones are most used".

```sql
SELECT coalesce(properties.<prop>, '(none)') AS dim,
       count() AS events, uniq(person_id) AS users
FROM events WHERE event = '<event>' AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY dim ORDER BY events DESC LIMIT 25
```

## Error rate against a baseline event

Use for "how often does X fail", "error rate by Y".

```sql
SELECT coalesce(properties.<prop>, '(none)') AS dim,
       countIf(event = '<error_event>') AS errors,
       countIf(event = '<baseline_event>') AS baseline,
       round(countIf(event = '<error_event>') / greatest(countIf(event = '<baseline_event>'), 1), 4) AS error_rate
FROM events
WHERE event IN ('<error_event>', '<baseline_event>') AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY dim ORDER BY errors DESC LIMIT 25
```

## Hourly trend for one event

Use for "did something spike", "what happened yesterday".

```sql
SELECT toStartOfHour(timestamp) AS hour, count() AS c
FROM events WHERE event = '<event>' AND timestamp >= now() - INTERVAL 2 DAY
GROUP BY hour ORDER BY hour ASC LIMIT 100
```

## Numeric property distribution (latency, duration, size)

Use for "how slow is X", "p95 load time".

```sql
SELECT quantile(0.5)(toFloat(properties.<numeric_prop>)) AS p50,
       quantile(0.9)(toFloat(properties.<numeric_prop>)) AS p90,
       quantile(0.99)(toFloat(properties.<numeric_prop>)) AS p99, count() AS n
FROM events WHERE event = '<event>' AND timestamp >= now() - INTERVAL 7 DAY LIMIT 1
```

## Two-step conversion / drop-off

Use for "what's the drop-off", "how many who did A also did B". No personal data leaves the query — only counts.

```sql
SELECT uniqIf(person_id, event = '<step1_event>') AS step1,
       uniqIf(person_id, event = '<step2_event>') AS step2
FROM events WHERE event IN ('<step1_event>','<step2_event>') AND timestamp >= now() - INTERVAL 7 DAY LIMIT 1
```

## Gotchas

- Date literals parse in the project's timezone. For an absolute instant use `toDateTime('2026-08-01 00:00:00', 'UTC')`.
- `OFFSET` returns HTTP 400 for personal API keys. Paginate on `timestamp` — but given the `LIMIT 100` rule, aggregate instead of paging.
- `uniq()` is approximate (HyperLogLog); `uniqExact()` is exact and slower. Say "approximately" in the report when the number came from `uniq()` and the magnitude matters.
- Property values are strings by default — wrap with `toFloat` / `toInt` before arithmetic or a quantile.
- `properties.<prop>` is null when the property is absent; wrap in `coalesce(…, '(none)')` so the bucket shows up instead of disappearing.
- Column aliases are usable in `GROUP BY` / `ORDER BY`; repeating the full expression is unnecessary.

#!/usr/bin/env node
// Renders a PostHog API response for the agent: truncated, delimiter-neutralized,
// never raw. Usage: node render.mjs <response.json> <http_status> [maxRows]
import { readFileSync } from "node:fs";

const MAX_CELL = 120;
const MAX_DETAIL = 600; // errors carry position info the agent needs to fix a query
const DEFINITION_FIELDS = ["name", "property_type", "last_seen_at", "is_numerical"];

// Mirrors the GAP construction in src/sanitize.ts: a reserved tag stays reserved
// however many invisible or whitespace characters are wedged between its letters.
const GAP = "[\\p{Cf}\\p{Cc}\\s]*";
const RESERVED = new RegExp(
  `<${GAP}\\/?${GAP}(?:${["slack-thread", "slack-message", "memory"]
    .map((tag) => tag.split("").join(GAP))
    .join("|")})(?![0-9A-Za-z-])[^>]*>`,
  "giu",
);

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

// NFKC folds full-width variants onto ASCII before RESERVED runs; control and
// format characters are flattened only afterwards, so they cannot hide a tag.
function clean(value, max = MAX_CELL) {
  let s = toText(value).normalize("NFKC");
  s = s.replace(RESERVED, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  s = s.replace(/\p{Cf}/gu, "");
  s = s.replace(/\p{Cc}/gu, " ");
  s = s.replace(/```/g, "'''");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatRow(row) {
  if (Array.isArray(row)) return row.map((cell) => clean(cell)).join(" | ");
  if (row && typeof row === "object") {
    return DEFINITION_FIELDS.filter((k) => k in row)
      .map((k) => `${k}=${clean(row[k])}`)
      .join(" | ");
  }
  return clean(row);
}

export function renderResponse(raw, status, maxRows = 20) {
  // 202 means PostHog accepted the query and is still computing it — not a failure.
  if (status === "202") {
    return `HTTP 202 query accepted but still running (query_status.id=${clean(raw?.query_status?.id ?? "-")}); results are not ready`;
  }
  const out = [];
  if (status !== "200") {
    out.push(`HTTP ${status} ${clean(raw?.type ?? "error")} / ${clean(raw?.code ?? "-")}`);
    out.push(clean(raw?.detail ?? JSON.stringify(raw ?? {}), MAX_DETAIL));
    return out.join("\n");
  }
  const rows = Array.isArray(raw?.results) ? raw.results : [];
  const cols = Array.isArray(raw?.columns) ? raw.columns : null;
  if (cols) out.push(`columns: ${cols.map((c) => clean(c)).join(" | ")}`);
  out.push(`rows_returned: ${rows.length}${raw?.hasMore ? " (server truncated)" : ""}`);
  for (const row of rows.slice(0, maxRows)) out.push(formatRow(row));
  if (rows.length > maxRows) out.push(`… ${rows.length - maxRows} more rows not shown`);
  return out.join("\n");
}

const [file, status = "200", maxRows = "20"] = process.argv.slice(2);
if (file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log(`HTTP ${status}: response was not valid JSON (empty or truncated)`);
    process.exit(1);
  }
  console.log(renderResponse(raw, status, Math.min(parseInt(maxRows, 10) || 20, 50)));
  if (status !== "200" && status !== "202") process.exit(1);
}

#!/usr/bin/env node
// Renders a PostHog API response for the agent: truncated, delimiter-neutralized,
// never raw. Usage: node render.mjs <response.json> <http_status> [maxRows]
import { readFileSync } from "node:fs";

const MAX_CELL = 120;
// Mirrors src/sanitize.ts: NFKC + format-char stripping folds full-width and
// zero-width-split variants onto this ASCII pattern before it runs.
const RESERVED = /<\s*\/?\s*(?:slack-thread|slack-message|memory)(?![0-9A-Za-z-])[^>]*>/gi;
const DEFINITION_FIELDS = ["name", "property_type", "last_seen_at", "is_numerical"];

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function clean(value) {
  let s = toText(value).normalize("NFKC").replace(/\p{Cf}/gu, "");
  s = s.replace(/[\u0000-\u001f\u007f]/g, " ");
  s = s.replace(RESERVED, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  s = s.replace(/```/g, "'''");
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

function formatRow(row) {
  if (Array.isArray(row)) return row.map(clean).join(" | ");
  if (row && typeof row === "object") {
    return DEFINITION_FIELDS.filter((k) => k in row)
      .map((k) => `${k}=${clean(row[k])}`)
      .join(" | ");
  }
  return clean(row);
}

export function renderResponse(raw, status, maxRows = 20) {
  const out = [];
  if (status !== "200") {
    out.push(`HTTP ${status} ${clean(raw?.type ?? "error")} / ${clean(raw?.code ?? "-")}`);
    out.push(clean(raw?.detail ?? JSON.stringify(raw ?? {}).slice(0, 400)));
    return out.join("\n");
  }
  const rows = raw?.results ?? [];
  const cols = raw?.columns;
  if (cols) out.push(`columns: ${cols.map(clean).join(" | ")}`);
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
  if (status !== "200") process.exit(1);
}

#!/usr/bin/env node
// Asks the wearable validator's run server one question with the bot's shared operator token.
// Usage: node skills/wearable-validator/query.mjs <stats|runs|run <id>|logs [since=ISO] [limit=n]|queue>
// Prints a compact text report; never the raw response, never the credentials.
const ENDPOINTS = { stats: "/api/stats", runs: "/api/runs?all=1", run: "/api/runs/", logs: "/api/logs", queue: "/api/queue" };
const MAX_LINES = 60;
const MAX_TEXT = 200;
// server text can carry attacker strings (a hostile Host header, a file name): control, bidi and zero-width
// characters and prompt delimiters are neutralized, and every field is bounded, before the model sees it
const clean = (value) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[`<>]/g, "'")
    .slice(0, MAX_TEXT);

const [what, ...args] = process.argv.slice(2);
if (!ENDPOINTS[what]) {
  console.error("usage: query.mjs <stats|runs|run <id>|logs [since=ISO] [limit=n]|queue>");
  process.exit(2);
}
const base = process.env.WEARABLE_VALIDATOR_API || "https://api.wearable-validator.dclregenesislabs.xyz";
const token = process.env.WEARABLE_VALIDATOR_TOKEN;
if (!token) {
  console.log("wearable-validator: not configured (WEARABLE_VALIDATOR_TOKEN missing)");
  process.exit(1);
}
let path = ENDPOINTS[what];
if (what === "run") {
  const runId = args[0] ?? "";
  if (!/^[0-9a-f]{8,32}$/.test(runId)) {
    console.error("run needs a hex id");
    process.exit(2);
  }
  path += runId;
}
if (what === "logs") {
  const params = new URLSearchParams();
  for (const arg of args) {
    const [key, value] = arg.split("=");
    if (key === "since" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value ?? "")) params.set("since", value);
    if (key === "limit" && /^\d{1,4}$/.test(value ?? "")) params.set("limit", value);
  }
  if ([...params].length) path += `?${params}`;
}

const response = await fetch(base + path, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  signal: AbortSignal.timeout(30_000)
});
if (!response.ok) {
  console.log(`wearable-validator: ${response.status} from ${what}` + (response.status === 401 ? " (the token was refused: OPERATOR_TOKEN on the server and WEARABLE_VALIDATOR_TOKEN here must match)" : ""));
  process.exit(1);
}
const body = await response.json();

const when = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "?");
if (what === "stats") {
  const r = body.runs;
  console.log(`runs: ${r.total} total · ${r.passed} passed · ${r.failed} needs attention · ${r.noVerdict} no verdict · ${r.running} rendering · ${r.waiting} waiting`);
  console.log(`average render: ${body.averageRunMs ? Math.round(body.averageRunMs / 1000) + " s" : "no render yet"} · slots: ${body.maxConcurrentRuns} · rules v${body.rulesVersion}`);
  console.log(`since: ${when(body.firstRunAt)} (server up since ${when(body.serverStartedAt)}; counts cover the run folders on disk)`);
  if (body.byDay.length) console.log("by day: " + body.byDay.slice(-14).map((d) => `${d.date} ${d.runs}`).join(" · "));
  if (body.byOwner.length) console.log("by curator: " + body.byOwner.slice(0, 20).map((o) => `${clean(o.owner)} ${o.runs}`).join(" · "));
} else if (what === "runs") {
  console.log(`${body.runs.length} runs (newest first)`);
  for (const run of body.runs.slice(0, MAX_LINES)) {
    const state = run.queued ? "waiting" : !run.done ? "rendering" : run.passed === true ? "passed" : run.passed === false ? "needs attention" : "no verdict";
    console.log(`${run.id.slice(0, 8)}  ${when(run.startedAt)}  ${state.padEnd(15)}  ${clean(run.owner)}  ${clean(run.name)}`);
  }
} else if (what === "run") {
  console.log(`${clean(body.name)} · ${body.done ? "finished" : "in progress"} · ${body.events.length} events`);
  for (const event of body.events.slice(-MAX_LINES)) {
    const d = event.data ?? {};
    if (event.type === "check" && d.type === "check-finished" && d.result?.status !== "passed") console.log(`  check ${clean(d.result.check)}: ${clean(d.result.status)}${d.result.skipReason ? " — " + clean(d.result.skipReason) : ""}`);
    else if (event.type === "gate") console.log(`  code gate: ${d.passed === true ? "passed" : "failed"}`);
    else if (event.type === "queue") console.log(`  queue: position ${Number(d.position)}`);
    else if (event.type === "stage") console.log(`  ${clean(d.text)}`);
    else if (event.type === "capture") console.log(`  captured ${clean(d.id)}`);
    else if (event.type === "review" && d.phase === "answer") console.log(`  model ${clean(d.check)}: ${d.ok ? clean(d.answer?.verdict) : "failed — " + clean(d.reason)}`);
    else if (event.type === "done") console.log(`  done${d.skipped ? " (skipped: " + clean(d.message) + ")" : ""}`);
    else if (event.type === "error") console.log(`  error: ${clean(d.message)}`);
  }
} else if (what === "logs") {
  console.log(`${body.lines.length} log lines`);
  for (const line of body.lines.slice(-MAX_LINES)) {
    const fields = Object.entries(line.fields ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${clean(k)}=${clean(typeof v === "string" ? v : JSON.stringify(v))}`)
      .join(" ");
    console.log(`${String(line.time).slice(11, 19)} ${clean(line.level).padEnd(5)} ${clean(line.message)}${fields ? "  " + fields : ""}`);
  }
} else if (what === "queue") {
  console.log(`rendering: ${body.running.length} · waiting: ${body.waiting.length} · average render ${body.averageRunMs ? Math.round(body.averageRunMs / 1000) + " s" : "unknown"}`);
}

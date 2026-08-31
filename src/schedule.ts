import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { Cron } from "croner";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createGuardedTools, type RunOptions } from "./agent.js";
import { AgentScheduler } from "./concurrency.js";
import { markdownToMrkdwn } from "./slack-utils.js";
import { redactSecrets } from "./sanitize.js";

const execFileAsync = promisify(execFile);

// --- Data model (mirrors decentraland/agent-server) ---

export interface Schedule {
  id: string;
  cron: string;
  task: string;
  description: string;
  channel: string;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
}

export interface ScheduleFile {
  schedules: Schedule[];
}

export interface StatsEntry {
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

export type StatsFile = Record<string, StatsEntry>;

const SCHEDULES_SUBDIR = "schedules";
const SCHEDULES_FILENAME = "schedules.json";
const STATS_FILENAME = "schedule-stats.json";

const NO_OUTPUT_SENTINEL = "NO_OUTPUT";
const TICK_INTERVAL_MS = 60_000;
const STATS_PUSH_INTERVAL_MS = 5 * 60_000;
const MAX_POST_LENGTH = 3000;
const MAX_STATUS_REASON_LENGTH = 200;
const MAX_ENABLED_SCHEDULES = 25;
const MIN_CRON_INTERVAL_MS = 5 * 60_000;
const CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]+$/;

export function schedulesFilePath(memoryDir: string): string {
  return join(memoryDir, SCHEDULES_SUBDIR, SCHEDULES_FILENAME);
}

export function statsFilePath(memoryDir: string): string {
  return join(memoryDir, SCHEDULES_SUBDIR, STATS_FILENAME);
}

// Fail open on read: a missing or corrupt file must never take the runner down.
export function readSchedules(path: string): ScheduleFile {
  if (!existsSync(path)) return { schedules: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(parsed?.schedules) ? parsed : { schedules: [] };
  } catch (err) {
    console.error(`[schedule] Corrupt schedules file at ${path}: ${(err as Error).message}`);
    return { schedules: [] };
  }
}

export function readStats(path: string): StatsFile {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

// Stats live in a SEPARATE file so this read-modify-write can never race the skill
// agent's writes to schedules.json (and e.g. resurrect a schedule it just deleted).
export function recordRunStats(statsPath: string, id: string, status: string, firedAt: Date): void {
  const stats = readStats(statsPath);
  stats[id] = {
    runCount: (stats[id]?.runCount ?? 0) + 1,
    lastRunAt: firedAt.toISOString(),
    lastRunStatus: status,
  };
  mkdirSync(dirname(statsPath), { recursive: true });
  const tmp = `${statsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(stats, null, 2), "utf-8");
  renameSync(tmp, statsPath);
}

/**
 * Defense-in-depth: the runner accepts whatever ends up in schedules.json, and the skill
 * prompt is guidance, not enforcement — so the effectful fields are re-checked here.
 * Returns a rejection reason, or null when the schedule is runnable.
 */
export function validateSchedule(schedule: Schedule): string | null {
  if (typeof schedule.id !== "string" || !schedule.id) return "missing id";
  if (typeof schedule.task !== "string" || !schedule.task.trim()) return "empty task";
  if (typeof schedule.cron !== "string") return "cron is not a string";
  if (typeof schedule.channel !== "string" || !CHANNEL_ID_PATTERN.test(schedule.channel)) {
    return `channel "${schedule.channel}" is not a Slack channel id`;
  }
  return null;
}

/** Due iff the cron expression (UTC) has a fire time inside (now - windowMs, now]. */
export function isDue(cronExpr: string, now: Date, windowMs: number): boolean {
  const cron = new Cron(cronExpr, { timezone: "UTC" });
  const next = cron.nextRun(new Date(now.getTime() - windowMs));
  return next !== null && next <= now;
}

/** Sampled guard against runaway crons: the gap from the next fire to the one after it
 * must be at least MIN_CRON_INTERVAL_MS. */
export function firesTooOften(cronExpr: string, from: Date): boolean {
  const cron = new Cron(cronExpr, { timezone: "UTC" });
  const first = cron.nextRun(from);
  if (!first) return false;
  const second = cron.nextRun(first);
  return second !== null && second.getTime() - first.getTime() < MIN_CRON_INTERVAL_MS;
}

export function formatSchedulePost(text: string, schedule: Schedule): string {
  // Redact before truncating: a token straddling the cut would otherwise survive as a
  // prefix the redaction patterns no longer match.
  const rendered = redactSecrets(markdownToMrkdwn(text));
  const body = rendered.length > MAX_POST_LENGTH ? rendered.slice(0, MAX_POST_LENGTH) + "\n...(truncated)" : rendered;
  const footer = `\n\n_Schedule: ${schedule.description} · \`${schedule.cron}\` · ID: ${schedule.id}_`;
  return body + redactSecrets(footer);
}

/** RunOptions for a scheduled fire: ephemeral session, no memory load/save, and the
 * non-U/W userId keeps the trusted slack_user_id header off the prompt. Scheduled runs
 * get no `schedulesFile` header and tools that block writes to the schedules dir AND the
 * runtime-skills dir (a planted SKILL.md loads into every later session), so an injection
 * in polled content has no sanctioned way to persist itself. */
export function buildScheduleRunOptions(schedule: Schedule, memoryDir: string, now: Date = new Date()): RunOptions {
  const ts = `schedule-${schedule.id}-${now.getTime()}`;
  return {
    threadTs: ts,
    eventTs: ts,
    userId: `schedule-${schedule.id}`,
    username: `schedule:${schedule.id}`,
    triggeredBy: `schedule:${schedule.id}`,
    newMessage: schedule.task,
    fetchThread: async () => schedule.task,
    fetchThreadSince: async () => "",
    sessionManager: SessionManager.inMemory(),
    isResumed: false,
    skipMemoryLoad: true,
    skipMemorySave: true,
    channelId: schedule.channel,
    tools: createGuardedTools(process.cwd(), [
      join(memoryDir, SCHEDULES_SUBDIR),
      join(memoryDir, "skills"),
    ]),
  };
}

// --- Git persistence ---
//
// The memory repo is the durable store: boot restore is the existing clone/pull in
// resolveMemoryDir(). This push covers the other direction. Definition changes go out
// on the next tick (≤60s); stats-only changes are batched (they change on every run).

/** Commit and push the schedule files. Throws on git failure so the caller can retry.
 * Async so a slow git (30s timeouts, rebase fallback) never blocks the event loop. */
export async function pushScheduleState(memoryDir: string, includeStats: boolean): Promise<void> {
  if (!existsSync(join(memoryDir, ".git"))) return;
  const git = async (...args: string[]) => {
    await execFileAsync("git", args, { cwd: memoryDir, timeout: 30_000 });
  };
  const paths = [schedulesFilePath(memoryDir)];
  if (includeStats) paths.push(statsFilePath(memoryDir));
  const existing = paths.filter((p) => existsSync(p));
  if (!existing.length) return;

  await git("add", "--", ...existing);
  const staged = await git("diff", "--cached", "--quiet", "--", ...existing).then(() => false, () => true);
  if (staged) {
    // --only scopes the commit to our paths, so anything a concurrent agent run has
    // staged (push-memory mid-flight) is neither swept up nor unstaged.
    await git("commit", "--only", "-m", "schedules: update schedule state", "--", ...existing);
  }
  // Push even when nothing new was staged — a previous commit may have failed to push.
  try {
    await git("push");
  } catch {
    // No --autostash: a dirty tree (a concurrent agent mid-write) should fail the push
    // and retry on a later tick, not risk losing a stash on a rebase conflict.
    await git("pull", "--rebase");
    await git("push");
  }
  if (staged) console.log("[schedule] Pushed schedule state to memory repo");
}

function fileFingerprint(path: string): string | null {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

// --- Runner ---

export interface ScheduleRunnerOptions {
  memoryDir: string;
  /** Run the schedule's task through the agent and return the response text. */
  runTask: (schedule: Schedule) => Promise<string>;
  /** Post a finished report to its Slack channel. */
  postMessage: (channel: string, text: string) => Promise<void>;
  /** Injected in tests. */
  now?: () => Date;
  /** Injected in tests. Default commits+pushes the schedule files to the memory repo. */
  push?: (includeStats: boolean) => void | Promise<void>;
}

export interface ScheduleRunner {
  stop: () => void;
  drain: (timeoutMs: number) => Promise<void>;
  /** Final unconditional push — call after drain so the last run's stats survive. */
  flush: () => Promise<void>;
  /** One tick, exposed for tests. */
  tickOnce: () => Promise<void>;
}

export function startScheduleRunner(opts: ScheduleRunnerOptions): ScheduleRunner {
  const schedulesPath = schedulesFilePath(opts.memoryDir);
  const statsPath = statsFilePath(opts.memoryDir);
  const now = opts.now ?? (() => new Date());
  const push = opts.push ?? ((includeStats: boolean) => pushScheduleState(opts.memoryDir, includeStats));

  const lane = new AgentScheduler(1); // separate lane so schedules never starve Slack users
  const inFlight = new Set<string>();
  let statsDirty = false;
  let lastStatsPushMs = now().getTime();
  // Post-boot-pull state is already in sync with the remote; push only on change.
  let lastPushedFingerprint = fileFingerprint(schedulesPath);

  mkdirSync(dirname(schedulesPath), { recursive: true });

  function fire(schedule: Schedule, firedAt: Date): void {
    inFlight.add(schedule.id);
    console.log(`[schedule] Firing "${schedule.description}" (${schedule.id})`);
    const submission = lane.submit(`schedule-${schedule.id}`, async () => {
      try {
        const text = await opts.runTask(schedule);
        const trimmed = (text ?? "").trim();
        let status: string;

        if (trimmed && !trimmed.startsWith(NO_OUTPUT_SENTINEL)) {
          await opts.postMessage(schedule.channel, formatSchedulePost(text, schedule));
          console.log(`[schedule] Posted output for "${schedule.description}" (${schedule.id}) to ${schedule.channel}`);
          status = "ok";
        } else {
          // The reason is agent-authored and shaped by whatever the task polled, and it
          // reaches the memory repo and Slack via the skill's `list` — redact before truncating.
          const firstLine = trimmed.slice(NO_OUTPUT_SENTINEL.length).split("\n")[0];
          const reason = redactSecrets(firstLine.replace(/^[:\s—–-]+/, "")).slice(0, MAX_STATUS_REASON_LENGTH);
          console.log(`[schedule] No output from "${schedule.description}" (${schedule.id})${reason ? `: ${reason}` : ""}`);
          status = reason ? `no output: ${reason}` : "no output";
        }

        // Stats key off the FIRE time, not completion: dedupe compares lastRunAt against
        // the due window, and a long run ending near the next due time must not eat it.
        recordRunStats(statsPath, schedule.id, status, firedAt);
      } catch (err) {
        // Redacted like every other sink: this string is pushed to the memory repo and
        // rendered back into Slack by the skill's `list`.
        const msg = redactSecrets(err instanceof Error ? err.message : "unknown error");
        console.error(`[schedule] Error running "${schedule.description}" (${schedule.id}): ${msg}`);
        recordRunStats(statsPath, schedule.id, `error: ${msg}`, firedAt);
      } finally {
        statsDirty = true;
        inFlight.delete(schedule.id);
      }
    });
    submission.done.catch((err) => {
      console.error(`[schedule] Unhandled rejection in "${schedule.description}": ${err}`);
    });
  }

  async function tickOnce(): Promise<void> {
    const tickNow = now();

    // Persist skill edits and batched stats. The fingerprint gate keeps quiet ticks free
    // of git subprocesses; on failure nothing is marked clean, so the next tick retries.
    const fingerprint = fileFingerprint(schedulesPath);
    const statsDue = statsDirty && tickNow.getTime() - lastStatsPushMs >= STATS_PUSH_INTERVAL_MS;
    if (fingerprint !== lastPushedFingerprint || statsDue) {
      try {
        await push(statsDue);
        lastPushedFingerprint = fingerprint;
        if (statsDue) {
          statsDirty = false;
          lastStatsPushMs = tickNow.getTime();
        }
      } catch (err) {
        console.error(`[schedule] Git push failed (will retry): ${(err as Error).message}`);
      }
    }

    const file = readSchedules(schedulesPath);
    let enabled = file.schedules.filter((s) => s.enabled);
    if (!enabled.length) return;
    if (enabled.length > MAX_ENABLED_SCHEDULES) {
      console.warn(`[schedule] ${enabled.length} enabled schedules — only the first ${MAX_ENABLED_SCHEDULES} will run`);
      enabled = enabled.slice(0, MAX_ENABLED_SCHEDULES);
    }
    console.log(`[schedule] Tick — ${file.schedules.length} schedules, ${enabled.length} enabled`);

    const stats = readStats(statsPath);
    const windowStart = new Date(tickNow.getTime() - TICK_INTERVAL_MS);

    for (const schedule of enabled) {
      // Never infer or trust a destination the header didn't provide — reject instead.
      const invalid = validateSchedule(schedule);
      if (invalid) {
        console.error(`[schedule] Skipping "${schedule.description}" (${schedule.id}) — ${invalid}`);
        continue;
      }
      try {
        if (!isDue(schedule.cron, tickNow, TICK_INTERVAL_MS)) continue;
        if (firesTooOften(schedule.cron, tickNow)) {
          console.error(`[schedule] Skipping "${schedule.description}" (${schedule.id}) — cron "${schedule.cron}" fires more often than every ${MIN_CRON_INTERVAL_MS / 60_000} minutes`);
          continue;
        }
      } catch (err) {
        console.error(`[schedule] Bad cron for "${schedule.id}": ${(err as Error).message}`);
        continue;
      }
      if (inFlight.has(schedule.id)) {
        console.warn(`[schedule] "${schedule.description}" (${schedule.id}) still running — skipping this fire`);
        continue;
      }
      // Dedupes a restart-within-the-window re-fire (stats survive via the memory repo).
      const lastRunAt = stats[schedule.id]?.lastRunAt;
      if (lastRunAt && new Date(lastRunAt) >= windowStart) {
        console.log(`[schedule] "${schedule.description}" (${schedule.id}) already ran at ${lastRunAt} — skipping`);
        continue;
      }
      fire(schedule, tickNow);
    }
  }

  const timer = setInterval(() => {
    tickOnce().catch((err) => console.error(`[schedule] Tick failed: ${err}`));
  }, TICK_INTERVAL_MS);
  timer.unref();

  console.log(`[schedule] Runner started — checking ${schedulesPath} every ${Math.round(TICK_INTERVAL_MS / 1000)}s`);

  return {
    stop: () => clearInterval(timer),
    drain: (timeoutMs: number) => lane.drain(timeoutMs),
    flush: async () => {
      try {
        await push(true);
      } catch (err) {
        console.error(`[schedule] Final push failed: ${(err as Error).message}`);
      }
    },
    tickOnce,
  };
}

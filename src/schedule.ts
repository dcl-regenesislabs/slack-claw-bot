import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { Cron } from "croner";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RunOptions } from "./agent.js";
import { AgentScheduler } from "./concurrency.js";
import { markdownToMrkdwn } from "./slack.js";
import { redactSecrets } from "./sanitize.js";

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
export function recordRunStats(statsPath: string, id: string, status: string, now: Date): void {
  const stats = readStats(statsPath);
  stats[id] = {
    runCount: (stats[id]?.runCount ?? 0) + 1,
    lastRunAt: now.toISOString(),
    lastRunStatus: status,
  };
  mkdirSync(dirname(statsPath), { recursive: true });
  const tmp = `${statsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(stats, null, 2), "utf-8");
  renameSync(tmp, statsPath);
}

/** Due iff the cron expression (UTC) has a fire time inside (now - windowMs, now]. */
export function isDue(cronExpr: string, now: Date, windowMs: number): boolean {
  const cron = new Cron(cronExpr, { timezone: "UTC" });
  const next = cron.nextRun(new Date(now.getTime() - windowMs));
  return next !== null && next <= now;
}

export function formatSchedulePost(text: string, schedule: Schedule): string {
  const body = text.length > MAX_POST_LENGTH ? text.slice(0, MAX_POST_LENGTH) + "\n...(truncated)" : text;
  const footer = `\n\n_Schedule: ${schedule.description} · \`${schedule.cron}\` · ID: ${schedule.id}_`;
  return redactSecrets(markdownToMrkdwn(body + footer));
}

/** RunOptions for a scheduled fire: ephemeral session, no memory load/save, and the
 * non-U/W userId keeps the trusted slack_user_id header off the prompt. */
export function buildScheduleRunOptions(schedule: Schedule, now: Date = new Date()): RunOptions {
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
  };
}

// --- Git persistence ---
//
// The memory repo is the durable store: boot restore is the existing clone/pull in
// resolveMemoryDir(). This push covers the other direction. Definition changes go out
// on the next tick (≤60s); stats-only changes are batched (they change on every run).

function pushScheduleState(memoryDir: string, includeStats: boolean): void {
  if (!existsSync(join(memoryDir, ".git"))) return;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: memoryDir, encoding: "utf-8", timeout: 30_000 });
  const schedulesPath = schedulesFilePath(memoryDir);
  const statsPath = statsFilePath(memoryDir);
  try {
    if (existsSync(schedulesPath)) git("add", "--", schedulesPath);
    if (includeStats && existsSync(statsPath)) git("add", "--", statsPath);
    try {
      git("diff", "--cached", "--quiet");
      return; // exit code 0 = nothing staged
    } catch {
      // exit code 1 = staged changes — proceed
    }
    git("commit", "-m", "schedules: update schedule state");
    try {
      git("push");
    } catch {
      git("pull", "--rebase", "--autostash");
      git("push");
    }
    console.log("[schedule] Pushed schedule state to memory repo");
  } catch (err) {
    console.error(`[schedule] Git commit/push failed: ${(err as Error).message}`);
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
  /** Injected in tests. Default commits+pushes schedules/ to the memory repo. */
  push?: (includeStats: boolean) => void;
}

export interface ScheduleRunner {
  stop: () => void;
  drain: (timeoutMs: number) => Promise<void>;
  /** Final unconditional push — call after drain so the last run's stats survive. */
  flush: () => void;
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

  mkdirSync(dirname(schedulesPath), { recursive: true });

  function fire(schedule: Schedule): void {
    inFlight.add(schedule.id);
    console.log(`[schedule] Firing "${schedule.description}" (${schedule.id})`);
    const submission = lane.submit(`schedule-${schedule.id}`, async () => {
      try {
        const text = await opts.runTask(schedule);
        if (text && !text.trim().startsWith(NO_OUTPUT_SENTINEL)) {
          await opts.postMessage(schedule.channel, formatSchedulePost(text, schedule));
        }
        recordRunStats(statsPath, schedule.id, "ok", now());
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.error(`[schedule] Error running "${schedule.description}" (${schedule.id}): ${msg}`);
        recordRunStats(statsPath, schedule.id, `error: ${msg}`, now());
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

    // Persist skill edits from the last minute; batch stats-only churn.
    const includeStats = statsDirty && tickNow.getTime() - lastStatsPushMs >= STATS_PUSH_INTERVAL_MS;
    push(includeStats);
    if (includeStats) {
      statsDirty = false;
      lastStatsPushMs = tickNow.getTime();
    }

    const file = readSchedules(schedulesPath);
    const enabled = file.schedules.filter((s) => s.enabled);
    if (!enabled.length) return;
    console.log(`[schedule] Tick — ${file.schedules.length} schedules, ${enabled.length} enabled`);

    const stats = readStats(statsPath);
    const windowStart = new Date(tickNow.getTime() - TICK_INTERVAL_MS);

    for (const schedule of enabled) {
      try {
        if (!isDue(schedule.cron, tickNow, TICK_INTERVAL_MS)) continue;
      } catch (err) {
        console.error(`[schedule] Bad cron for "${schedule.id}": ${(err as Error).message}`);
        continue;
      }
      // Never infer a destination — a channel-less schedule must not guess where to post.
      if (!schedule.channel) {
        console.error(`[schedule] Skipping "${schedule.description}" (${schedule.id}) — no channel set`);
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
      fire(schedule);
    }
  }

  const timer = setInterval(() => {
    tickOnce().catch((err) => console.error(`[schedule] Tick failed: ${err}`));
  }, TICK_INTERVAL_MS);
  timer.unref();

  console.log(`[schedule] Runner started — checking ${schedulesPath} every ${TICK_INTERVAL_MS / 1000}s`);

  return {
    stop: () => clearInterval(timer),
    drain: (timeoutMs: number) => lane.drain(timeoutMs),
    flush: () => push(true),
    tickOnce,
  };
}

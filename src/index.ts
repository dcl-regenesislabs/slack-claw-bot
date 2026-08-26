process.on("unhandledRejection", (err) => {
  console.error("[process] Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
  process.exit(1);
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { initAgent, runAgent } from "./agent.js";
import { createSlackApp, startSlackApp, createScheduler } from "./slack.js";
import { startScheduleRunner, buildScheduleRunOptions, type ScheduleRunner } from "./schedule.js";
import { startHealthServer } from "./health.js";
import { resolveMemoryDir, resolveGrantsAgentsDir, clonePublicRepo } from "./memory.js";
import { initGrants } from "./grants.js";
import type { GrantsRouter } from "./grants.js";
import { DiscourseClient } from "./discourse.js";

const config = loadConfig();
if (process.env.DEBUG) console.log("[debug] Debug mode enabled");

if (config.healthPort) {
  startHealthServer(config.healthPort);
}

let memoryDir: string | undefined;
try {
  memoryDir = resolveMemoryDir(config.memoryRepo);
} catch (err) {
  console.error("[startup] Failed to set up memory:", err);
}

await initAgent({
  anthropicOAuthSetupToken: config.anthropicOAuthSetupToken,
  githubToken: config.githubToken,
  model: config.model,
  memoryDir,
  timeoutMs: config.agentTimeoutMs,
});

const scheduler = createScheduler(config.maxConcurrentAgents);

// Grants feature — opt-in via env vars. The router is wired lazily so that
// initGrants() can attach its own listeners to the same App instance.
let grantsRouter: GrantsRouter | null = null;
const app = createSlackApp(config, scheduler, () => grantsRouter);

if (config.grantsChannelId && config.grantsAgentsRepo && memoryDir) {
  const grantsAgentsDir = resolveGrantsAgentsDir(config.grantsAgentsRepo);
  const opendclDir = clonePublicRepo(config.opendclRepo, "opendcl", "opendcl");
  const jarvisDir = clonePublicRepo(config.jarvisRepo, "jarvis", "jarvis");
  const discourse = config.discourse
    ? new DiscourseClient(config.discourse.url, config.discourse.apiKey)
    : null;
  if (grantsAgentsDir) {
    const grants = initGrants({
      config,
      memoryDir,
      grantsAgentsDir,
      opendclDir,
      jarvisDir,
      discourse,
    });
    grantsRouter = grants.router;
    console.log(
      `[startup] Grants feature enabled${discourse ? " (Discourse integration active)" : " (Discourse disabled — !post is local-only)"}`,
    );
  } else {
    console.warn("[startup] Grants agents repo unavailable — grants feature disabled");
  }
} else if (config.grantsChannelId) {
  console.warn("[startup] GRANTS_CHANNEL_ID set but GRANTS_AGENTS_REPO or memory dir missing — feature disabled");
}

await startSlackApp(app, { socketMaxSilenceMs: config.slackSocketMaxSilenceMs });

let scheduleRunner: ScheduleRunner | null = null;
if (memoryDir) {
  const memDir = memoryDir;
  if (!existsSync(join(memDir, ".git"))) {
    console.warn("[schedule] Memory dir is not git-backed — schedules will NOT survive a redeploy");
  }
  scheduleRunner = startScheduleRunner({
    memoryDir: memDir,
    runTask: async (schedule) => {
      const result = await runAgent(buildScheduleRunOptions(schedule, memDir));
      await result.done;
      return result.text;
    },
    postMessage: async (channel, text) => {
      await app.client.chat.postMessage({ channel, text });
    },
  });
} else {
  console.warn("[schedule] No memory dir — schedules disabled");
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] ${signal} received — draining...`);

  scheduleRunner?.stop();

  try {
    await app.stop();
  } catch (err) {
    console.error("[shutdown] Failed to stop Slack app:", err);
  }

  await Promise.all([scheduler.drain(20_000), scheduleRunner?.drain(15_000)]);
  await scheduleRunner?.flush();

  console.log("[shutdown] Done");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

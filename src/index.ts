process.on("unhandledRejection", (err) => {
  console.error("[process] Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
  process.exit(1);
});

import { loadConfig } from "./config.js";
import { initAgent } from "./agent.js";
import { createSlackApp, startSlackApp, createScheduler } from "./slack.js";
import { startHealthServer } from "./health.js";
import { resolveMemoryDir, resolveGrantsAgentsDir, clonePublicRepo } from "./memory.js";
import { initGrants } from "./grants.js";
import type { GrantsRouter } from "./grants.js";

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
  anthropicOAuthRefreshToken: config.anthropicOAuthRefreshToken,
  githubToken: config.githubToken,
  model: config.model,
  upstashRedisUrl: config.upstashRedisUrl,
  upstashRedisToken: config.upstashRedisToken,
  memoryDir,
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
  if (grantsAgentsDir) {
    const grants = initGrants(config, memoryDir, grantsAgentsDir, opendclDir, jarvisDir);
    grantsRouter = grants.router;
    console.log("[startup] Grants feature enabled");
  } else {
    console.warn("[startup] Grants agents repo unavailable — grants feature disabled");
  }
} else if (config.grantsChannelId) {
  console.warn("[startup] GRANTS_CHANNEL_ID set but GRANTS_AGENTS_REPO or memory dir missing — feature disabled");
}

await startSlackApp(app);

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] ${signal} received — draining...`);

  try {
    await app.stop();
  } catch (err) {
    console.error("[shutdown] Failed to stop Slack app:", err);
  }

  await scheduler.drain(20_000);

  console.log("[shutdown] Done");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

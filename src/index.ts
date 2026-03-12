process.on("unhandledRejection", (err) => {
  console.error("[process] Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
  process.exit(1);
});

import { loadConfig } from "./config.js";
import { initAgent } from "./agent.js";
import { startSlackBot, createScheduler } from "./slack.js";
import { startHealthServer } from "./health.js";
import { ensureMemoryDirs, pullMemoryRepo } from "./memory.js";
import { join } from "node:path";

const config = loadConfig();

if (config.healthPort) {
  startHealthServer(config.healthPort);
}

if (config.memoryRepo) {
  try {
    pullMemoryRepo(config.memoryRepo, join(config.dataDir, "memory"));
  } catch (err) {
    console.error("[startup] Failed to pull memory repo, continuing with local state:", err);
  }
}
ensureMemoryDirs(join(config.dataDir, "memory"));

await initAgent({
  anthropicOAuthRefreshToken: config.anthropicOAuthRefreshToken,
  githubToken: config.githubToken,
  model: config.model,
  upstashRedisUrl: config.upstashRedisUrl,
  upstashRedisToken: config.upstashRedisToken,
  dataDir: config.dataDir,
});

const scheduler = createScheduler(config.maxConcurrentAgents);
const app = await startSlackBot(config, scheduler);

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

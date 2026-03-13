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
import { resolveMemoryDir } from "./memory.js";

const config = loadConfig();

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

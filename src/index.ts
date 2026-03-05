process.on("unhandledRejection", (err) => {
  console.error("[process] Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
  process.exit(1);
});

import { loadConfig } from "./config.js";
import { initAgent } from "./agent.js";
import { startSlackBot } from "./slack.js";
import { startHealthServer } from "./health.js";

const config = loadConfig();

if (config.healthPort) {
  startHealthServer(config.healthPort);
}

await initAgent({
  anthropicOAuthRefreshToken: config.anthropicOAuthRefreshToken,
  githubToken: config.githubToken,
  model: config.model,
  upstashRedisUrl: config.upstashRedisUrl,
  upstashRedisToken: config.upstashRedisToken,
});

await startSlackBot(config);

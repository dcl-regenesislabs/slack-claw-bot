import { loadConfig } from "./config.js";
import { initAgent } from "./agent.js";
import { startSlackBot } from "./slack.js";
import { startHealthServer } from "./health.js";

const config = loadConfig();

if (config.healthPort) {
  startHealthServer(config.healthPort);
}

await initAgent({
  anthropicApiKey: config.anthropicApiKey,
  anthropicOAuthRefreshToken: config.anthropicOAuthRefreshToken,
  githubToken: config.githubToken,
  model: config.model,
  upstashRedisUrl: config.upstashRedisUrl,
  upstashRedisToken: config.upstashRedisToken,
});

await startSlackBot(config);

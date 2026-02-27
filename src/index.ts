import { loadConfig } from "./config.js";
import { initAgent } from "./agent.js";
import { startSlackBot } from "./slack.js";
import { startHealthServer } from "./health.js";

const config = loadConfig();

startHealthServer();

if (!config.anthropicApiKey && !config.anthropicOAuthRefreshToken) {
  console.error("ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_REFRESH_TOKEN is required");
  process.exit(1);
}

initAgent({
  anthropicApiKey: config.anthropicApiKey,
  anthropicOAuthRefreshToken: config.anthropicOAuthRefreshToken,
  githubToken: config.githubToken,
  model: config.model,
});

await startSlackBot(config);

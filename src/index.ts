import { loadConfig } from "./config.js";
import { initAgent } from "./agent.js";
import { startSlackBot } from "./slack.js";
import { startHealthServer } from "./health.js";

const config = loadConfig();

startHealthServer();

if (!config.anthropicApiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

initAgent({
  anthropicApiKey: config.anthropicApiKey,
  githubToken: config.githubToken,
  model: config.model,
});

await startSlackBot(config);

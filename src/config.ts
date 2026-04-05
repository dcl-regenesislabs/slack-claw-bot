import "dotenv/config";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  githubToken: string;
  anthropicApiKey?: string;
  anthropicSetupToken?: string;
  model?: string;
  maxConcurrentAgents: number;
  logChannelId?: string;
  healthPort?: number;
  memoryRepo?: string;
  agentBackend: "pi-agent" | "cli";
}

export function loadConfig(): Config {
  return {
    slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv("SLACK_APP_TOKEN"),
    githubToken: requireEnv("GITHUB_TOKEN"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicSetupToken: process.env.ANTHROPIC_SETUP_TOKEN,
    model: process.env.MODEL,
    maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || "3", 10),
    logChannelId: process.env.LOG_CHANNEL_ID,
    healthPort: process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : undefined,
    memoryRepo: process.env.MEMORY_REPO,
    agentBackend: parseAgentBackend(process.env.AGENT_BACKEND),
  };
}

const VALID_BACKENDS = ["pi-agent", "cli"] as const;

function parseAgentBackend(value?: string): "pi-agent" | "cli" {
  if (!value) return "cli";
  if (VALID_BACKENDS.includes(value as "pi-agent" | "cli")) return value as "pi-agent" | "cli";
  console.error(`Invalid AGENT_BACKEND "${value}". Valid values: ${VALID_BACKENDS.join(", ")}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

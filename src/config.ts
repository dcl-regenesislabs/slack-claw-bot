import "dotenv/config";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  githubToken: string;
  anthropicApiKey?: string;
  anthropicOAuthRefreshToken?: string;
  model?: string;
  maxConcurrentAgents: number;
  maxQueueSize: number;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
  logChannelId?: string;
  healthPort?: number;
}

export function loadConfig(): Config {
  return {
    slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv("SLACK_APP_TOKEN"),
    githubToken: requireEnv("GITHUB_TOKEN"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicOAuthRefreshToken: process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN,
    model: process.env.MODEL,
    maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || "3", 10),
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "10", 10),
    upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    logChannelId: process.env.LOG_CHANNEL_ID,
    healthPort: process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : undefined,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

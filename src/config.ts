import "dotenv/config";
import type { DiscourseConfig } from "./discourse.js";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  githubToken: string;
  anthropicOAuthRefreshToken?: string;
  model?: string;
  maxConcurrentAgents: number;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
  logChannelId?: string;
  healthPort?: number;
  memoryRepo?: string;
  grantsChannelId?: string;
  grantsAgentsRepo?: string;
  grantsMaxConcurrentAgents: number;
  opendclRepo: string;
  jarvisRepo: string;
  discourse: DiscourseConfig | null;
}

export function loadConfig(): Config {
  return {
    slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv("SLACK_APP_TOKEN"),
    githubToken: requireEnv("GITHUB_TOKEN"),
    anthropicOAuthRefreshToken: process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN,
    model: process.env.MODEL,
    maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || "3", 10),
    upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    logChannelId: process.env.LOG_CHANNEL_ID,
    healthPort: process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : undefined,
    memoryRepo: process.env.MEMORY_REPO,
    grantsChannelId: process.env.GRANTS_CHANNEL_ID,
    grantsAgentsRepo: process.env.GRANTS_AGENTS_REPO,
    grantsMaxConcurrentAgents: parseInt(process.env.GRANTS_MAX_CONCURRENT_AGENTS || "4", 10),
    opendclRepo: process.env.OPENDCL_REPO || "dcl-regenesislabs/opendcl",
    jarvisRepo: process.env.JARVIS_REPO || "decentraland/jarvis",
    discourse: loadDiscourseConfig(),
  };
}

function loadDiscourseConfig(): DiscourseConfig | null {
  const url = process.env.DISCOURSE_URL;
  const apiKey = process.env.DISCOURSE_API_KEY;
  const categoryId = process.env.DISCOURSE_CATEGORY_ID;
  if (!url || !apiKey || !categoryId) return null;
  const categoryIdNum = parseInt(categoryId, 10);
  if (!Number.isFinite(categoryIdNum)) {
    console.warn(`[config] DISCOURSE_CATEGORY_ID is not a number: ${categoryId} — Discourse disabled`);
    return null;
  }
  const username = process.env.DISCOURSE_USERNAME;
  if (!username) {
    console.warn("[config] DISCOURSE_USERNAME is required when Discourse is enabled — Discourse disabled");
    return null;
  }
  return { url, apiKey, categoryId: categoryIdNum, username };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

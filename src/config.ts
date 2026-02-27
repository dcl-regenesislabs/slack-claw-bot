import "dotenv/config";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  githubToken: string;
  anthropicApiKey?: string;
  anthropicOAuthRefreshToken?: string;
  model?: string;
  defaultRepos: string[];
  repoAliases: Record<string, string>;
  maxConcurrentAgents: number;
  maxQueueSize: number;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
}

export function loadConfig(): Config {
  return {
    slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv("SLACK_APP_TOKEN"),
    githubToken: requireEnv("GITHUB_TOKEN"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicOAuthRefreshToken: process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN,
    model: process.env.MODEL,
    defaultRepos: parseCommaSeparated(process.env.DEFAULT_REPOS),
    repoAliases: parseAliases(process.env.REPO_ALIASES),
    maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || "3", 10),
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "10", 10),
    upstashRedisUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
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

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseAliases(value: string | undefined): Record<string, string> {
  const aliases: Record<string, string> = {};
  if (!value) return aliases;

  for (const entry of value.split(",")) {
    const [alias, repo] = entry.split(":").map((s) => s.trim());
    if (alias && repo) {
      aliases[alias.toLowerCase()] = repo;
    }
  }
  return aliases;
}

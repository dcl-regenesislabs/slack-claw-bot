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
}

export function loadConfig(): Config {
  const slackBotToken = requireEnv("SLACK_BOT_TOKEN");
  const slackAppToken = requireEnv("SLACK_APP_TOKEN");
  const githubToken = requireEnv("GITHUB_TOKEN");
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const anthropicOAuthRefreshToken = process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN;
  const model = process.env.MODEL;
  const defaultRepos = parseCommaSeparated(process.env.DEFAULT_REPOS);
  const repoAliases = parseAliases(process.env.REPO_ALIASES);
  const maxConcurrentAgents = parseInt(process.env.MAX_CONCURRENT_AGENTS || "3", 10);
  const maxQueueSize = parseInt(process.env.MAX_QUEUE_SIZE || "10", 10);

  return {
    slackBotToken,
    slackAppToken,
    githubToken,
    anthropicApiKey,
    anthropicOAuthRefreshToken,
    model,
    defaultRepos,
    repoAliases,
    maxConcurrentAgents,
    maxQueueSize,
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

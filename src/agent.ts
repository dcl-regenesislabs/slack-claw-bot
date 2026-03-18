import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { ICacheStorageComponent } from "@dcl/core-commons";
import { buildPrompt } from "./prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

const REDIS_KEY = "anthropic_auth";

interface AgentConfig {
  anthropicOAuthRefreshToken?: string;
  githubToken?: string;
  model?: string;
  redis?: ICacheStorageComponent;
  sentryAuthToken?: string;
  sentryOrg?: string;
}

export interface RunOptions {
  threadContent: string;
  dryRun?: boolean;
  triggeredBy?: string;
  events?: EventEmitter;
  model?: string;
}

export const REVIEW_MODEL = "claude-opus-4-6";
export const PR_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
export const REVIEW_KEYWORD_PATTERN = /\breview\b/i;

export interface RunResult {
  text: string;
  cost: number;
  tokens: number;
}

let authStorage: AuthStorage | null = null;
let modelId: string;
let redisComponent: ICacheStorageComponent | null = null;
let lastAuthSnapshot: string | null = null;

const authPath = process.env.NODE_ENV === "production" && existsSync("/data")
  ? "/data/.auth.json"
  : join(projectDir, ".auth.json");

export async function initAgent(config: AgentConfig): Promise<void> {
  if (config.githubToken) {
    process.env.GITHUB_TOKEN = config.githubToken;
  }
  if (config.sentryAuthToken) {
    process.env.SENTRY_AUTH_TOKEN = config.sentryAuthToken;
  }
  if (config.sentryOrg) {
    process.env.SENTRY_ORG = config.sentryOrg;
  }

  modelId = config.model || "claude-sonnet-4-5";
  redisComponent = config.redis ?? null;

  const stored = redisComponent ? await redisComponent.get<string>(REDIS_KEY).catch(() => null) : null;

  if (stored) {
    console.log("[agent] Loaded auth state from Redis");
    writeFileSync(authPath, stored, "utf-8");
    lastAuthSnapshot = stored;
  } else if (existsSync(authPath)) {
    console.log("[agent] Using existing .auth.json");
  } else if (config.anthropicOAuthRefreshToken) {
    console.log("[agent] Seeding auth from ANTHROPIC_OAUTH_REFRESH_TOKEN env var");
    const seed = JSON.stringify({
      anthropic: { type: "oauth", refresh: config.anthropicOAuthRefreshToken, access: "", expires: 0 },
    });
    writeFileSync(authPath, seed, "utf-8");
  } else {
    throw new Error(
      "No auth available. Set ANTHROPIC_OAUTH_REFRESH_TOKEN or place a valid .auth.json in the project root."
    );
  }

  authStorage = AuthStorage.create(authPath);
}

export async function syncAuth(): Promise<void> {
  if (!redisComponent || !existsSync(authPath)) return;

  const data = readFileSync(authPath, "utf-8");
  if (data === lastAuthSnapshot) return;

  lastAuthSnapshot = data;
  await redisComponent.set(REDIS_KEY, data).catch((err: unknown) => {
    console.error("[agent] Failed to sync auth to Redis:", err);
  });
  console.log("[agent] Auth token rotated — synced to Redis");
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  if (!authStorage) {
    throw new Error("Agent not initialized — call initAgent() first");
  }

  const { threadContent, dryRun, triggeredBy, events } = options;
  const effectiveModelId = options.model || modelId;
  const sessionManager = SessionManager.inMemory();

  const systemPrompt = readFileSync(
    join(projectDir, "prompts/system.md"),
    "utf-8"
  ).trim();

  const modelRegistry = new ModelRegistry(authStorage);
  const model = modelRegistry.find("anthropic", effectiveModelId);
  if (!model) {
    throw new Error(`Model "anthropic/${effectiveModelId}" not found`);
  }

  const cwd = process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    additionalSkillPaths: [join(projectDir, "skills")],
    systemPrompt,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    model,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    resourceLoader,
    tools: createCodingTools(cwd),
  });

  try {
    const prompt = buildPrompt(threadContent, dryRun, triggeredBy);

    if (events) {
      subscribeToTextDeltas(session, events);
    }

    console.log("[agent] running prompt...");
    console.log("[agent] prompt:", prompt.slice(0, 200));
    console.log("[agent] model:", effectiveModelId);
    await session.prompt(prompt);

    const messageCount = session.messages.length;
    console.log("[agent] messages in session:", messageCount);
    for (const msg of session.messages) {
      const content = "content" in msg ? JSON.stringify(msg.content).slice(0, 200) : "N/A";
      const extra = msg.role === "assistant"
        ? ` stopReason=${(msg as any).stopReason} error=${(msg as any).errorMessage ?? "none"}`
        : "";
      console.log(`[agent]   role=${msg.role}${extra} content=${content}`);
    }

    const { cost, tokens } = computeUsage(session.messages);
    console.log(`[agent] done — ${tokens} tokens, $${cost.toFixed(4)}`);

    const text = session.getLastAssistantText() || "";
    console.log("[agent] result length:", text.length);
    return { text, cost, tokens };
  } finally {
    session.dispose();
  }
}

function subscribeToTextDeltas(session: any, events: EventEmitter): void {
  session.subscribe((event: any) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      events.emit("text", event.assistantMessageEvent.delta);
    }
  });
}

function computeUsage(messages: any[]): { cost: number; tokens: number } {
  let cost = 0;
  let tokens = 0;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.usage) {
      cost += msg.usage.cost?.total ?? 0;
      tokens += msg.usage.totalTokens ?? 0;
    }
  }

  return { cost, tokens };
}

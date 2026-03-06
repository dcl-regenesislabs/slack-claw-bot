import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { MediaAttachment } from "./slack.js";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { buildPrompt } from "./prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

interface RedisConfig {
  url: string;
  token: string;
}

interface AgentConfig {
  anthropicOAuthRefreshToken?: string;
  githubToken?: string;
  model?: string;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
}

export interface RunOptions {
  threadContent: string;
  images?: MediaAttachment[];
  videos?: MediaAttachment[];
  files?: MediaAttachment[];
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

const authPath = join(projectDir, ".auth.json");
let redisConfig: RedisConfig | null = null;
let lastAuthSnapshot: string | null = null;

export async function initAgent(config: AgentConfig): Promise<void> {
  if (config.githubToken) {
    process.env.GITHUB_TOKEN = config.githubToken;
  }

  modelId = config.model || "claude-sonnet-4-5";

  if (config.upstashRedisUrl && config.upstashRedisToken) {
    redisConfig = { url: config.upstashRedisUrl, token: config.upstashRedisToken };
  }

  const stored = redisConfig ? await redisGet(redisConfig) : null;

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
  if (!redisConfig || !existsSync(authPath)) return;

  const data = readFileSync(authPath, "utf-8");
  if (data === lastAuthSnapshot) return;

  lastAuthSnapshot = data;
  await redisSet(redisConfig, data);
  console.log("[agent] Auth token rotated — synced to Redis");
}

async function redisGet(cfg: RedisConfig): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.url}/get/anthropic_auth`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const body = await res.json() as { result: string | null };
    return body.result ?? null;
  } catch (err) {
    console.error("[agent] Failed to load from Redis:", err);
    return null;
  }
}

async function redisSet(cfg: RedisConfig, value: string): Promise<void> {
  try {
    await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", "anthropic_auth", value]),
    });
  } catch (err) {
    console.error("[agent] Failed to save to Redis:", err);
  }
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  if (!authStorage) {
    throw new Error("Agent not initialized — call initAgent() first");
  }

  const { threadContent, dryRun, triggeredBy, events } = options;
  const images = options.images ?? [];
  const allMedia = [...images, ...(options.videos ?? []), ...(options.files ?? [])];
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

  let tempDir: string | undefined;

  try {
    let mediaPaths: string[] | undefined;

    if (allMedia.length > 0) {
      tempDir = mkdtempSync(join(tmpdir(), "slack-media-"));
      mediaPaths = allMedia.map((attachment, i) => {
        const filePath = join(tempDir!, `${i}-${basename(attachment.filename)}`);
        writeFileSync(filePath, Buffer.from(attachment.data, "base64"));
        return filePath;
      });
    }

    const imageContents: ImageContent[] | undefined = images.length > 0
      ? images.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }))
      : undefined;

    const prompt = buildPrompt(threadContent, dryRun, triggeredBy, mediaPaths);

    if (events) {
      subscribeToTextDeltas(session, events);
    }

    console.log("[agent] running prompt...");
    console.log("[agent] prompt:", prompt.slice(0, 200));
    console.log("[agent] model:", effectiveModelId);
    if (mediaPaths) {
      console.log(`[agent] media: ${mediaPaths.length} files (${imageContents?.length ?? 0} images for vision)`);
    }
    await session.prompt(prompt, imageContents ? { images: imageContents } : undefined);

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
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error("[agent] Failed to clean up temp dir:", err);
      }
    }
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

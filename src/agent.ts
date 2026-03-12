import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname, relative } from "node:path";
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
  type ExtensionFactory,
  type AgentSession,
  type AgentSessionEvent,
  type CustomEntry,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { buildPrompt } from "./prompt.js";
import {
  loadMemoryContext,
  buildMemorySavePrompt,
  snapshotMemoryFiles,
  processMemoryPostSave,
  ensureMemoryDirs,
  ensureQmd,
  reindexMemory,
} from "./memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

// --- Types ---

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
  dataDir?: string;
}

export interface RunOptions {
  threadTs: string;
  eventTs: string;
  username: string;
  newMessage: string;
  fetchThread: () => Promise<string>;
  fetchThreadSince: (oldest: string) => Promise<string>;
  dryRun?: boolean;
  triggeredBy?: string;
  events?: EventEmitter;
  model?: string;
}

export interface RunResult {
  text: string;
  cost: number;
  tokens: number;
}

// --- Module State ---

const REVIEW_MODEL = "claude-opus-4-6";
const SAVE_MARKER = "[SAVE]";
const PR_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const REVIEW_KEYWORD_PATTERN = /\breview\b/i;

let authStorage: AuthStorage | null = null;
let defaultModelId: string;
const authPath = join(projectDir, ".auth.json");
let redisConfig: RedisConfig | null = null;
let lastAuthSnapshot: string | null = null;
let sessionDir: string | null = null;
let memoryDir: string | null = null;

// --- Public API ---

export function detectReviewModel(text: string): string | undefined {
  if (PR_URL_PATTERN.test(text) || REVIEW_KEYWORD_PATTERN.test(text)) {
    return REVIEW_MODEL;
  }
}

export async function initAgent(config: AgentConfig): Promise<void> {
  if (config.githubToken) process.env.GITHUB_TOKEN = config.githubToken;
  defaultModelId = config.model || "claude-sonnet-4-5";

  if (config.dataDir) {
    sessionDir = join(config.dataDir, "sessions");
    memoryDir = join(config.dataDir, "memory");
    mkdirSync(sessionDir, { recursive: true });
    ensureMemoryDirs(memoryDir);
    ensureQmd(memoryDir);
  }

  if (config.upstashRedisUrl && config.upstashRedisToken) {
    redisConfig = { url: config.upstashRedisUrl, token: config.upstashRedisToken };
  }

  await loadAuth(config.anthropicOAuthRefreshToken);
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

export async function runAgent(options: RunOptions): Promise<RunResult> {
  if (!authStorage) throw new Error("Agent not initialized — call initAgent() first");

  const modelId = options.model || defaultModelId;
  const { sessionManager, isResumed } = await resolveSession(options.threadTs);
  const memorySnapshots = memoryDir ? snapshotMemoryFiles(memoryDir) : new Map<string, string>();
  const memoryContent = memoryDir ? loadMemoryContext(memoryDir, options.username) : "";
  if (memoryDir) {
    console.log(`[memory] Loaded context for ${options.username} (${memoryContent.length} chars, ${memorySnapshots.size} files tracked)`);
  } else {
    console.log("[memory] No dataDir configured — memory disabled");
  }

  const { session } = await createSession(modelId, memoryContent, sessionManager);

  try {
    // 1. Build prompt (with gap messages if resuming)
    const prompt = isResumed
      ? await buildResumePrompt(options, sessionManager)
      : await buildNewPrompt(options);

    if (options.events) subscribeToTextDeltas(session, options.events);

    // 2. Run agent
    console.log(`[agent] running (model: ${modelId}, prompt: ${prompt.slice(0, 200)})`);
    await session.prompt(prompt);
    const rawResponse = session.getLastAssistantText() || "";

    // 3. Save memory if the agent signaled [SAVE] or used tools
    sessionManager.appendCustomEntry("slack_last_seen_ts", { ts: options.eventTs });
    const usedTools = hasToolCalls(session.messages);
    const hasSaveMarker = rawResponse.includes(SAVE_MARKER);
    if (usedTools || hasSaveMarker) {
      await saveMemory(session, options.username, memorySnapshots);
    } else {
      console.log("[agent] Skipping memory save — no tools used and no [SAVE] marker");
    }

    const response = rawResponse.replace(/\n?\[SAVE\]\s*$/g, "").trimEnd();

    const { cost, tokens } = computeUsage(session.messages);
    console.log(`[agent] done — ${tokens} tokens, $${cost.toFixed(4)}`);
    return { text: response, cost, tokens };
  } finally {
    session.dispose();
  }
}

// --- Session ---

async function resolveSession(threadTs: string): Promise<{ sessionManager: SessionManager; isResumed: boolean }> {
  if (!sessionDir) {
    return { sessionManager: SessionManager.inMemory(), isResumed: false };
  }

  const sessionPath = join(sessionDir, `${threadTs}.jsonl`);
  const isResumed = existsSync(sessionPath);

  try {
    return { sessionManager: SessionManager.open(sessionPath, sessionDir), isResumed };
  } catch (err) {
    console.error("[agent] Corrupt session file, starting fresh:", err);
    try { unlinkSync(sessionPath); } catch {}
    return { sessionManager: SessionManager.open(sessionPath, sessionDir), isResumed: false };
  }
}

async function createSession(modelId: string, memoryContent: string, sessionManager: SessionManager) {
  const systemPrompt = readFileSync(join(projectDir, "prompts/system.md"), "utf-8").trim();
  const modelRegistry = new ModelRegistry(authStorage!);
  const model = modelRegistry.find("anthropic", modelId);
  if (!model) throw new Error(`Model "anthropic/${modelId}" not found`);

  const cwd = process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    additionalSkillPaths: [join(projectDir, "skills")],
    systemPrompt,
    extensionFactories: memoryContent ? [createMemoryExtension(memoryContent)] : [],
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  return createAgentSession({
    cwd,
    authStorage: authStorage!,
    modelRegistry,
    model,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    resourceLoader,
    tools: createCodingTools(cwd),
  });
}

// --- Prompt Building ---

async function buildNewPrompt(options: RunOptions): Promise<string> {
  const threadContent = await options.fetchThread();
  return buildPrompt(threadContent, options.dryRun, options.triggeredBy);
}

async function buildResumePrompt(options: RunOptions, sessionManager: SessionManager): Promise<string> {
  const lastSeenTs = findLastSeenTs(sessionManager);
  if (lastSeenTs) {
    const gapContent = await options.fetchThreadSince(lastSeenTs);
    if (gapContent) {
      sessionManager.appendCustomMessageEntry(
        "slack_gap",
        `Messages since last interaction:\n\n${gapContent}`,
        false,
      );
    }
  }
  return buildPrompt(options.newMessage, options.dryRun, options.triggeredBy, true);
}

function findLastSeenTs(sessionManager: SessionManager): string | null {
  let lastSeenTs: string | null = null;
  for (const entry of sessionManager.getEntries()) {
    if (entry.type === "custom") {
      const custom = entry as CustomEntry<{ ts: string }>;
      if (custom.customType === "slack_last_seen_ts") {
        lastSeenTs = custom.data?.ts ?? null;
      }
    }
  }
  return lastSeenTs;
}

// --- Memory ---

function createMemoryExtension(content: string): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => ({
      systemPrompt: event.systemPrompt + "\n\n" + content,
    }));
  };
}

async function saveMemory(session: AgentSession, username: string, snapshots: Map<string, string>): Promise<void> {
  if (!memoryDir) return;

  const timer = setTimeout(() => {
    console.warn("[agent] Memory save timed out after 60s");
    session.abort().catch(() => {});
  }, 60_000);

  try {
    await session.prompt(buildMemorySavePrompt(username, memoryDir));
  } catch (err) {
    console.error("[agent] Memory save failed:", err);
  } finally {
    clearTimeout(timer);
  }

  const result = processMemoryPostSave(memoryDir, snapshots);
  if (result.changedFiles.length > 0) {
    console.log(`[memory] Save complete — ${result.changedFiles.length} file(s) changed:`);
    for (const f of result.changedFiles) console.log(`[memory]   ${relative(memoryDir, f)}`);
  } else {
    console.log("[memory] Save complete — no files changed");
  }
  reindexMemory();
  for (const w of result.warnings) console.warn(`[memory] ${w}`);
}

// --- Auth ---

async function loadAuth(refreshToken?: string): Promise<void> {
  const stored = redisConfig ? await redisGet(redisConfig) : null;

  if (stored) {
    console.log("[agent] Loaded auth state from Redis");
    writeFileSync(authPath, stored, "utf-8");
    lastAuthSnapshot = stored;
  } else if (existsSync(authPath)) {
    console.log("[agent] Using existing .auth.json");
  } else if (refreshToken) {
    console.log("[agent] Seeding auth from ANTHROPIC_OAUTH_REFRESH_TOKEN");
    writeFileSync(authPath, JSON.stringify({
      anthropic: { type: "oauth", refresh: refreshToken, access: "", expires: 0 },
    }), "utf-8");
  } else {
    throw new Error("No auth available. Set ANTHROPIC_OAUTH_REFRESH_TOKEN or place a valid .auth.json");
  }
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

// --- Utilities ---

function subscribeToTextDeltas(session: AgentSession, events: EventEmitter): void {
  session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      events.emit("text", event.assistantMessageEvent.delta);
    }
  });
}

function hasToolCalls(messages: AgentMessage[]): boolean {
  return messages.some(
    (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((c) => c.type === "toolCall"),
  );
}

function computeUsage(messages: AgentMessage[]): { cost: number; tokens: number } {
  let cost = 0;
  let tokens = 0;
  for (const msg of messages) {
    if (msg.role === "assistant" && "usage" in msg) {
      cost += msg.usage.cost?.total ?? 0;
      tokens += msg.usage.totalTokens ?? 0;
    }
  }
  return { cost, tokens };
}

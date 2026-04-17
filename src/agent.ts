import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
  createWriteTool,
  createEditTool,
  createBashTool,
  createReadTool,
  type WriteOperations,
  type EditOperations,
  type BashSpawnContext,
  type ExtensionFactory,
  type AgentSession,
  type AgentSessionEvent,
  type CustomEntry,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { constants } from "node:fs";
import { buildPrompt, type FileAttachment } from "./prompt.js";
import {
  loadMemoryContext,
  buildMemorySavePrompt,
  ensureQmd,
  reindexMemory,
} from "./memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

// --- Guarded Tools ---

const PROTECTED_PREFIXES = ["src/", "test/", "node_modules/"];
const PROTECTED_FILES = ["package.json", "package-lock.json", "tsconfig.json", ".auth.json"];

function isProtectedPath(absolutePath: string): boolean {
  const abs = resolve(absolutePath);
  const rel = relative(projectDir, abs);
  // Outside the project dir — not protected (rel starts with ".." or is absolute when no common root)
  if (rel.startsWith("..") || rel === abs) return false;
  for (const prefix of PROTECTED_PREFIXES) {
    if (rel.startsWith(prefix) || rel === prefix.slice(0, -1)) return true;
  }
  for (const file of PROTECTED_FILES) {
    if (rel === file) return true;
  }
  // .env* files
  if (/^\.env/.test(rel)) return true;
  return false;
}

function createGuardedTools(cwd: string): AgentTool<any>[] {
  // Read tool — unrestricted
  const read = createReadTool(cwd);

  // Write tool — blocks protected paths
  const guardedWriteOps: WriteOperations = {
    async writeFile(absolutePath: string, content: string) {
      if (isProtectedPath(absolutePath)) {
        throw new Error(`Blocked: cannot write to protected project file "${relative(projectDir, absolutePath)}". Project source files (src/, test/, package.json, etc.) are read-only.`);
      }
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
    },
    async mkdir(dir: string) {
      if (isProtectedPath(dir)) {
        throw new Error(`Blocked: cannot create directory in protected path "${relative(projectDir, dir)}".`);
      }
      await mkdir(dir, { recursive: true });
    },
  };
  const write = createWriteTool(cwd, { operations: guardedWriteOps });

  // Edit tool — blocks protected paths
  const guardedEditOps: EditOperations = {
    async readFile(absolutePath: string) {
      return readFile(absolutePath);
    },
    async writeFile(absolutePath: string, content: string) {
      if (isProtectedPath(absolutePath)) {
        throw new Error(`Blocked: cannot edit protected project file "${relative(projectDir, absolutePath)}". Project source files (src/, test/, package.json, etc.) are read-only.`);
      }
      await writeFile(absolutePath, content, "utf-8");
    },
    async access(absolutePath: string) {
      await access(absolutePath, constants.R_OK | constants.W_OK);
    },
  };
  const edit = createEditTool(cwd, { operations: guardedEditOps });

  // Bash tool — best-effort guard against writes to protected paths
  const WRITE_PATTERNS = [">", ">>", "tee ", "cp ", "mv ", "rm ", "sed -i", "chmod ", "chown "];
  const bash = createBashTool(cwd, {
    spawnHook(ctx: BashSpawnContext) {
      const cmd = ctx.command;
      for (const pattern of WRITE_PATTERNS) {
        if (!cmd.includes(pattern)) continue;
        // Check if the command references a protected path
        for (const prefix of PROTECTED_PREFIXES) {
          // Match paths like src/foo, ./src/foo, or absolute paths
          const prefixName = prefix.slice(0, -1); // "src" from "src/"
          if (new RegExp(`(^|\\s|/)(\\./)?${prefixName}(/|\\s|$)`).test(cmd) ||
              cmd.includes(join(projectDir, prefix))) {
            throw new Error(`Blocked: bash command appears to write to protected path "${prefixName}/". Project source files are read-only.`);
          }
        }
        for (const file of PROTECTED_FILES) {
          if (new RegExp(`(^|\\s|/)(\\./)?${file.replace(".", "\\.")}(\\s|$)`).test(cmd) ||
              cmd.includes(join(projectDir, file))) {
            throw new Error(`Blocked: bash command appears to write to protected file "${file}". Project config files are read-only.`);
          }
        }
        // .env files
        if (/(^|\s|\/)(\.\/)?\.env/.test(cmd) || cmd.includes(join(projectDir, ".env"))) {
          throw new Error("Blocked: bash command appears to write to a .env file.");
        }
      }
      return ctx;
    },
  });

  return [read, bash, edit, write];
}

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
  memoryDir?: string;
}

export interface RunOptions {
  threadTs: string;
  eventTs: string;
  userId: string;
  username: string;
  newMessage: string;
  fetchThread: () => Promise<string>;
  fetchThreadSince: (oldest: string) => Promise<string>;
  dryRun?: boolean;
  triggeredBy?: string;
  events?: EventEmitter;
  model?: string;
  files?: FileAttachment[];
  /** Override the default system prompt (skips reading prompts/system.md). */
  systemPrompt?: string;
  /** Skip the post-run memory save. Used by grant agents whose learnings live elsewhere. */
  skipMemorySave?: boolean;
  /** Override the default file-backed session. When provided, resolveSession() is bypassed. */
  sessionManager?: SessionManager;
  /** Override isResumed detection when sessionManager is provided. Defaults to false. */
  isResumed?: boolean;
  /** Skip loading memory context into the system prompt. */
  skipMemoryLoad?: boolean;
  /** Extra skill paths to load (prepended, so they take priority over defaults). */
  additionalSkillPaths?: string[];
}

export interface RunResult {
  text: string;
  cost: number;
  tokens: number;
  /** Resolves when memory save + session cleanup are complete. */
  done: Promise<void>;
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

  if (config.memoryDir) {
    memoryDir = config.memoryDir;
    ensureQmd(memoryDir);
  }
  sessionDir = join(tmpdir(), "claw-sessions");
  mkdirSync(sessionDir, { recursive: true });

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

  // If caller provided a sessionManager, use it directly and skip resolveSession entirely.
  const { sessionManager, isResumed } = options.sessionManager
    ? { sessionManager: options.sessionManager, isResumed: options.isResumed ?? false }
    : await resolveSession(options.threadTs);

  const shouldLoadMemory = !options.skipMemoryLoad && memoryDir;
  const memoryContent = shouldLoadMemory
    ? loadMemoryContext(memoryDir!, options.userId, options.username)
    : "";
  if (shouldLoadMemory) {
    console.log(`[memory] Loaded context for ${options.username} (${options.userId}) (${memoryContent.length} chars)`);
    if (process.env.DEBUG && memoryContent) console.log(`[debug] memory context:\n${memoryContent}`);
  } else if (options.skipMemoryLoad) {
    console.log("[memory] Memory load skipped per RunOptions");
  } else {
    console.log("[memory] No memoryDir configured — memory disabled");
  }

  const { session } = await createSession(modelId, memoryContent, sessionManager, options.systemPrompt, options.additionalSkillPaths);

  try {
    // 1. Build prompt (with gap messages if resuming)
    const prompt = isResumed
      ? await buildResumePrompt(options, sessionManager)
      : await buildNewPrompt(options);

    if (options.events) subscribeToTextDeltas(session, options.events);
    if (process.env.DEBUG) subscribeToDebugLogs(session);

    // 2. Run agent
    console.log(`[agent] running (model: ${modelId}, prompt: ${prompt.slice(0, 200)})`);
    await session.prompt(prompt);
    const rawResponse = session.getLastAssistantText() || "";

    // 3. Save memory async — response goes back to Slack immediately
    sessionManager.appendCustomEntry("slack_last_seen_ts", { ts: options.eventTs });
    const usedTools = hasToolCalls(session.messages);
    const hasSaveMarker = rawResponse.includes(SAVE_MARKER);

    const shouldSave = !options.skipMemorySave && (usedTools || hasSaveMarker);
    if (!shouldSave) {
      if (options.skipMemorySave) {
        console.log("[agent] Skipping memory save — skipMemorySave flag set");
      } else {
        console.log("[agent] Skipping memory save — no tools used and no [SAVE] marker");
      }
      session.dispose();
    }
    const done = shouldSave
      ? saveMemory(session, options.userId, options.username).finally(() => session.dispose())
      : Promise.resolve();

    const response = rawResponse.replace(/\n?\[SAVE\]\s*$/g, "").trimEnd();

    const { cost, tokens } = computeUsage(session.messages);
    console.log(`[agent] done — ${tokens} tokens, $${cost.toFixed(4)}`);
    return { text: response, cost, tokens, done };
  } catch (err) {
    session.dispose();
    throw err;
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

async function createSession(
  modelId: string,
  memoryContent: string,
  sessionManager: SessionManager,
  systemPromptOverride?: string,
  extraSkillPaths?: string[],
) {
  const systemPrompt = systemPromptOverride
    ?? readFileSync(join(projectDir, "prompts/system.md"), "utf-8").trim();
  const modelRegistry = ModelRegistry.create(authStorage!);
  const model = modelRegistry.find("anthropic", modelId);
  if (!model) throw new Error(`Model "anthropic/${modelId}" not found`);

  const cwd = process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    additionalSkillPaths: [
      ...(extraSkillPaths ?? []),
      join(projectDir, "skills"),
      ...(memoryDir ? [join(memoryDir, "skills")] : []),
    ],
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
    tools: createGuardedTools(cwd),
  });
}

// --- Prompt Building ---

async function buildNewPrompt(options: RunOptions): Promise<string> {
  const threadContent = await options.fetchThread();
  return buildPrompt(threadContent, options.dryRun, options.triggeredBy, undefined, options.files);
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
  return buildPrompt(options.newMessage, options.dryRun, options.triggeredBy, true, options.files);
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

async function saveMemory(session: AgentSession, userId: string, username: string): Promise<void> {
  if (!memoryDir) return;

  const timer = setTimeout(() => {
    console.warn("[agent] Memory save timed out after 60s");
    session.abort().catch(() => {});
  }, 60_000);

  try {
    await session.prompt(buildMemorySavePrompt(memoryDir, userId, username));
    console.log("[memory] Save complete");
  } catch (err) {
    console.error("[agent] Memory save failed:", err);
  } finally {
    clearTimeout(timer);
  }

  reindexMemory();
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

function subscribeToDebugLogs(session: AgentSession): void {
  session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "tool_execution_start":
        console.log(`[debug] tool:start ${event.toolName}`, JSON.stringify(event.args).slice(0, 200));
        break;
      case "tool_execution_end":
        console.log(`[debug] tool:end ${event.toolName}`, event.isError ? "ERROR" : "ok", JSON.stringify(event.result).slice(0, 200));
        break;
      case "turn_start":
        console.log("[debug] turn:start");
        break;
      case "turn_end":
        console.log("[debug] turn:end");
        break;
      case "message_start":
        console.log(`[debug] message:start (${event.message.role})`);
        break;
      case "message_end":
        console.log(`[debug] message:end (${event.message.role})`);
        break;
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

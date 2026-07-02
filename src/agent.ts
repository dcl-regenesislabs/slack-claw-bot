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
  getAgentDir,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
  createReadToolDefinition,
  type ToolDefinition,
  type WriteOperations,
  type EditOperations,
  type BashSpawnContext,
  type ExtensionFactory,
  type AgentSession,
  type AgentSessionEvent,
  type CustomEntry,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
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

// `any` type args needed for variance: concrete defs (e.g. the bash tool's typed
// renderCall) aren't assignable to the default ToolDefinition<TSchema, unknown>.
type AnyToolDefinition = ToolDefinition<any, any, any>;

function createGuardedTools(cwd: string): AnyToolDefinition[] {
  // Read tool — unrestricted
  const read = createReadToolDefinition(cwd);

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
  const write = createWriteToolDefinition(cwd, { operations: guardedWriteOps });

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
  const edit = createEditToolDefinition(cwd, { operations: guardedEditOps });

  // Bash tool — best-effort guard against writes to protected paths
  const WRITE_PATTERNS = [">", ">>", "tee ", "cp ", "mv ", "rm ", "sed -i", "chmod ", "chown "];
  const bash = createBashToolDefinition(cwd, {
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

interface AgentConfig {
  anthropicOAuthSetupToken?: string;
  githubToken?: string;
  model?: string;
  memoryDir?: string;
  /** Watchdog timeout for a single agent run. Defaults to 15 minutes. */
  timeoutMs?: number;
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
  /** Slack channel name, surfaced to the agent so it can resolve the channel's default repo. */
  channelName?: string;
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
  /** Override the default guarded tool set (read/bash/edit/write). Pass `[]` to
   * give the agent no tools — it can only produce text. Used by grant agents
   * to prevent any external side-effects (curl, git clone, fs). */
  tools?: AnyToolDefinition[];
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
// Preferred first; falls back to the next entry pi's model registry knows about.
const DEFAULT_MODEL_CANDIDATES = ["claude-sonnet-5", "claude-sonnet-4-5"];
const SAVE_MARKER = "[SAVE]";
const PR_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const REVIEW_KEYWORD_PATTERN = /\breview\b/i;

const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1000;

let authStorage: AuthStorage | null = null;
let defaultModelId: string;
const authPath = join(projectDir, ".auth.json");
let sessionDir: string | null = null;
let memoryDir: string | null = null;
let agentTimeoutMs = DEFAULT_AGENT_TIMEOUT_MS;

// --- Public API ---

export function detectReviewModel(text: string): string | undefined {
  if (PR_URL_PATTERN.test(text) || REVIEW_KEYWORD_PATTERN.test(text)) {
    return REVIEW_MODEL;
  }
}

export async function initAgent(config: AgentConfig): Promise<void> {
  if (config.githubToken) process.env.GITHUB_TOKEN = config.githubToken;

  if (config.memoryDir) {
    memoryDir = config.memoryDir;
    ensureQmd(memoryDir);
  }
  if (config.timeoutMs) agentTimeoutMs = config.timeoutMs;
  sessionDir = join(tmpdir(), "claw-sessions");
  mkdirSync(sessionDir, { recursive: true });

  loadAuth(config.anthropicOAuthSetupToken);
  authStorage = AuthStorage.create(authPath);

  defaultModelId = config.model || resolveDefaultModel();
  console.log(`[agent] default model: ${defaultModelId}`);
}

function resolveDefaultModel(): string {
  const registry = ModelRegistry.create(authStorage!);
  for (const id of DEFAULT_MODEL_CANDIDATES) {
    if (registry.find("anthropic", id)) return id;
  }
  return DEFAULT_MODEL_CANDIDATES[DEFAULT_MODEL_CANDIDATES.length - 1];
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

  const { session } = await createSession(modelId, memoryContent, sessionManager, options.systemPrompt, options.additionalSkillPaths, options.tools);

  try {
    // 1. Build prompt (with gap messages if resuming)
    const prompt = isResumed
      ? await buildResumePrompt(options, sessionManager)
      : await buildNewPrompt(options);

    if (options.events) subscribeToTextDeltas(session, options.events);
    subscribeToToolLogs(session);
    if (process.env.DEBUG) subscribeToDebugLogs(session);

    // 2. Run agent — with a watchdog so a stalled stream or hung tool can't wedge
    // the run (and its scheduler slot) forever. abort() surfaces through getTurnError.
    console.log(`[agent] running (model: ${modelId}, prompt: ${prompt.slice(0, 200)})`);
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      console.warn(`[agent] Run exceeded ${agentTimeoutMs}ms — aborting session`);
      session.abort().catch(() => {});
    }, agentTimeoutMs);
    try {
      await session.prompt(prompt);
    } catch (err) {
      if (!timedOut) throw err;
    } finally {
      clearTimeout(watchdog);
    }

    if (timedOut) {
      throw new Error(`I gave up after ${Math.round(agentTimeoutMs / 60_000)} minutes — the task took too long. Try breaking it into smaller steps.`);
    }

    // prompt() resolves even on LLM/auth failures — surface them instead of an empty fallback.
    const turnError = getTurnError(session.messages);
    if (turnError) throw new Error(turnError);

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
  toolsOverride?: AnyToolDefinition[],
) {
  const systemPrompt = systemPromptOverride
    ?? readFileSync(join(projectDir, "prompts/system.md"), "utf-8").trim();
  const modelRegistry = ModelRegistry.create(authStorage!);
  const model = modelRegistry.find("anthropic", modelId);
  if (!model) throw new Error(`Model "anthropic/${modelId}" not found`);

  const cwd = process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
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

  // Guarded tools shadow the built-in read/bash/edit/write by name; the `tools`
  // allowlist restricts the session to exactly our definitions ([] → no tools).
  const toolDefinitions = toolsOverride ?? createGuardedTools(cwd);

  return createAgentSession({
    cwd,
    authStorage: authStorage!,
    modelRegistry,
    model,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    resourceLoader,
    tools: toolDefinitions.map((tool) => tool.name),
    customTools: toolDefinitions,
  });
}

// --- Prompt Building ---

async function buildNewPrompt(options: RunOptions): Promise<string> {
  const threadContent = await options.fetchThread();
  return buildPrompt(threadContent, options.dryRun, options.triggeredBy, undefined, options.files, options.channelName);
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
  return buildPrompt(options.newMessage, options.dryRun, options.triggeredBy, true, options.files, options.channelName);
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

// One year in ms — the lifetime of a `claude setup-token`. We stamp the seeded
// access token with this far-future expiry so the SDK never attempts a refresh.
const SETUP_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// Auth lives entirely in .auth.json. ANTHROPIC_OAUTH_SETUP_TOKEN holds a long-lived
// `claude setup-token` (sk-ant-oat…, ~1 year) — which is itself the OAuth *access* token,
// used directly as the Bearer. It is NOT a refresh token, so we seed it into `access` with
// a far-future expiry; seeding it as `refresh` (expires: 0) makes the SDK attempt a
// grant_type=refresh_token exchange that fails with "No API key for provider: anthropic".
// Because the token stays valid for a year, a fresh container that re-seeds from the env
// var still authenticates — no external store needed.
function loadAuth(oauthToken?: string): void {
  if (existsSync(authPath)) {
    console.log("[agent] Using existing .auth.json");
  } else if (oauthToken) {
    console.log("[agent] Seeding auth from ANTHROPIC_OAUTH_SETUP_TOKEN");
    writeFileSync(authPath, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: oauthToken,
        refresh: oauthToken,
        expires: Date.now() + SETUP_TOKEN_TTL_MS,
      },
    }), "utf-8");
  } else {
    throw new Error("No auth available. Set ANTHROPIC_OAUTH_SETUP_TOKEN or place a valid .auth.json");
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

// Always-on tool activity log — when a run hangs, this shows which tool it died in.
function subscribeToToolLogs(session: AgentSession): void {
  session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "tool_execution_start":
        console.log(`[agent] tool:start ${event.toolName}`, JSON.stringify(event.args).slice(0, 200));
        break;
      case "tool_execution_end":
        console.log(`[agent] tool:end ${event.toolName}`, event.isError ? "ERROR" : "ok", JSON.stringify(event.result).slice(0, 200));
        break;
    }
  });
}

function subscribeToDebugLogs(session: AgentSession): void {
  session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
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

/**
 * Inspect the final assistant turn for a failed/aborted stopReason. pi-agent encodes
 * LLM and auth errors this way rather than throwing, so this is the only signal that
 * a turn silently failed. Returns the error text to throw, or null if the turn succeeded.
 */
export function getTurnError(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const { stopReason, errorMessage } = msg as { stopReason?: string; errorMessage?: string };
    if (stopReason === "error" || stopReason === "aborted") {
      return errorMessage || `Agent turn ${stopReason} with no error detail`;
    }
    return null; // last assistant turn succeeded
  }
  return null;
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

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventEmitter } from "node:events";
import { ClaudeCliBackend } from "./cli/index.js";
import { PiAgentProvider } from "./pi/index.js";
import type { AgentProvider, AgentProviderType } from "./types.js";
import { prepareWorkspace } from "../workspace.js";
import { buildPrompt, type FileAttachment } from "../prompt.js";
import {
  loadMemoryContext,
  buildMemorySavePrompt,
  ensureQmd,
  reindexMemory,
} from "../memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "../..");

function createProvider(type: AgentProviderType): AgentProvider {
  if (type === "cli") return new ClaudeCliBackend();
  return new PiAgentProvider();
}

export interface AgentConfig {
  backend?: AgentProviderType;
  githubToken?: string;
  model?: string;
  memoryDir?: string;
  slackBotToken?: string;
  // pi-agent specific
  anthropicApiKey?: string;
  // cli specific — long-lived token from `claude setup-token`
  anthropicSetupToken?: string;
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
}

export interface RunResult {
  text: string;
  cost: number;
  tokens: number;
  done: Promise<void>;
}

const REVIEW_MODEL = "claude-opus-4-6";
const SAVE_MARKER = "[SAVE]";
const PR_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const REVIEW_KEYWORD_PATTERN = /\breview\b/i;

let provider: AgentProvider;
let defaultModelId: string;
let memoryDir: string | undefined;
let workspaceDir: string;
let systemPromptBase: string;

// Maps threadTs to last-seen Slack event timestamp
const lastSeenTs = new Map<string, string>();

export function detectReviewModel(text: string): string | undefined {
  if (PR_URL_PATTERN.test(text) || REVIEW_KEYWORD_PATTERN.test(text)) {
    return REVIEW_MODEL;
  }
}

export async function initAgent(config: AgentConfig): Promise<void> {
  defaultModelId = config.model || "claude-sonnet-4-5";
  memoryDir = config.memoryDir;

  if (memoryDir) {
    ensureQmd(memoryDir);
  }

  // Cache system prompt once
  systemPromptBase = readFileSync(join(projectDir, "prompts/system.md"), "utf-8").trim();

  workspaceDir = prepareWorkspace({ memoryDir });
  console.log("[agent] Workspace: %s", workspaceDir);

  provider = createProvider(config.backend || "cli");
  await provider.init({
    githubToken: config.githubToken,
    model: config.model,
    memoryDir: config.memoryDir,
    slackBotToken: config.slackBotToken,
    anthropicApiKey: config.anthropicApiKey,
    anthropicSetupToken: config.anthropicSetupToken,
  });

  console.log("[agent] Provider: %s", config.backend || "cli");
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  if (!provider) throw new Error("Agent not initialized — call initAgent() first");

  const modelId = options.model || defaultModelId;
  const sessionId = options.threadTs;
  const isResume = isExistingSession(sessionId);

  const memoryContent = memoryDir
    ? loadMemoryContext(memoryDir, options.userId, options.username)
    : "";
  if (memoryDir) {
    console.log(`[memory] Loaded context for ${options.username} (${memoryContent.length} chars)`);
  }

  const systemPrompt = isResume ? undefined : buildFullSystemPrompt(memoryContent);
  if (process.env.DEBUG && systemPrompt) {
    console.log(`[debug] system prompt (${systemPrompt.length} chars):\n${systemPrompt.slice(0, 500)}...`);
  }

  let prompt: string;
  if (isResume) {
    const previousTs = lastSeenTs.get(sessionId);
    let gapContent = "";
    if (previousTs) {
      gapContent = await options.fetchThreadSince(previousTs);
    }
    const messageWithGap = gapContent
      ? `Messages since last interaction:\n\n${gapContent}\n\n---\n\n${options.newMessage}`
      : options.newMessage;
    prompt = buildPrompt(messageWithGap, options.dryRun, options.triggeredBy, true, options.files);
  } else {
    const threadContent = await options.fetchThread();
    prompt = buildPrompt(threadContent, options.dryRun, options.triggeredBy, undefined, options.files);
  }

  console.log(`[agent] Running (model: ${modelId}, resume: ${isResume}, prompt: ${prompt.slice(0, 200)})`);
  if (process.env.DEBUG) {
    console.log(`[debug] full prompt (${prompt.length} chars):\n${prompt}`);
  }
  const result = await provider.run({
    prompt,
    model: modelId,
    sessionId,
    isResume,
    systemPrompt,
    cwd: workspaceDir,
    onTextDelta: options.events
      ? (delta) => options.events!.emit("text", delta)
      : undefined,
  });

  lastSeenTs.set(sessionId, options.eventTs);

  const rawResponse = result.text;
  const hasSaveMarker = rawResponse.includes(SAVE_MARKER);
  const shouldSave = result.usedTools || hasSaveMarker;

  if (process.env.DEBUG) {
    console.log(`[debug] usedTools=${result.usedTools} hasSaveMarker=${hasSaveMarker} shouldSave=${shouldSave}`);
  }
  if (!shouldSave) {
    console.log("[agent] Skipping memory save — no tools used and no [SAVE] marker");
    provider.disposeSession?.(sessionId);
  }

  const response = rawResponse.replace(/\n?\[SAVE\]\s*$/g, "").trimEnd();
  console.log(`[agent] rawResponse (${rawResponse.length} chars): "${rawResponse.slice(0, 200)}"`);

  const done = shouldSave
    ? saveMemory(sessionId, modelId, options.userId, options.username)
        .finally(() => provider.disposeSession?.(sessionId))
    : Promise.resolve();

  console.log(`[agent] Done — ${result.tokens} tokens, $${result.cost.toFixed(4)}`);
  return { text: response, cost: result.cost, tokens: result.tokens, done };
}

function isExistingSession(sessionId: string): boolean {
  return provider.isKnownSession?.(sessionId) ?? lastSeenTs.has(sessionId);
}

function buildFullSystemPrompt(memoryContent: string): string {
  return memoryContent ? `${systemPromptBase}\n\n${memoryContent}` : systemPromptBase;
}

async function saveMemory(
  sessionId: string,
  modelId: string,
  userId: string,
  username: string,
): Promise<void> {
  if (!memoryDir) return;

  const savePrompt = buildMemorySavePrompt(memoryDir, userId, username);
  console.log("[memory] Starting save (session: %s, memoryDir: %s)", sessionId, memoryDir);
  if (process.env.DEBUG) {
    console.log(`[debug] save prompt (${savePrompt.length} chars):\n${savePrompt.slice(0, 300)}...`);
  }

  try {
    if (provider.runFollowUp) {
      await provider.runFollowUp(sessionId, savePrompt);
    } else {
      const saveResult = await provider.run({
        prompt: savePrompt,
        model: modelId,
        sessionId,
        isResume: true,
        cwd: workspaceDir,
      });
      console.log("[memory] Save response: %s tokens, usedTools=%s", saveResult.tokens, saveResult.usedTools);
      if (process.env.DEBUG) {
        console.log(`[debug] save response text:\n${saveResult.text.slice(0, 500)}`);
      }
    }
  } catch (err) {
    console.error("[agent] Memory save failed:", err);
  }

  console.log("[memory] Save complete");
  reindexMemory();
}

import { readFileSync, mkdirSync } from "node:fs";
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
  createBashTool,
  createReadTool,
} from "@mariozechner/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

interface AgentConfig {
  anthropicApiKey: string;
  githubToken?: string;
  model?: string;
}

export interface RunOptions {
  threadContent: string;
  repo?: string;
  dryRun?: boolean;
  events?: EventEmitter;
  sessionId?: string;
}

let authStorage: AuthStorage | null = null;
let modelId: string;

export function initAgent(config: AgentConfig): void {
  if (config.githubToken) {
    process.env.GITHUB_TOKEN = config.githubToken;
  }

  authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("anthropic", config.anthropicApiKey);
  modelId = config.model || "claude-sonnet-4-5";
}

export async function runAgent(options: RunOptions): Promise<string> {
  if (!authStorage) {
    throw new Error("Agent not initialized — call initAgent() first");
  }

  const { threadContent, repo, dryRun, events, sessionId } = options;
  const sessionManager = createSessionManager(sessionId);

  const systemPrompt = readFileSync(
    join(projectDir, "prompts/system.md"),
    "utf-8"
  ).trim();

  const modelRegistry = new ModelRegistry(authStorage);
  const model = modelRegistry.find("anthropic", modelId);
  if (!model) {
    throw new Error(`Model "anthropic/${modelId}" not found`);
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
    tools: [createBashTool(cwd), createReadTool(cwd)],
  });

  try {
    const prompt = buildPrompt(threadContent, repo, dryRun);

    if (events) {
      subscribeToTextDeltas(session, events);
    }

    console.log("[agent] running prompt...");
    console.log("[agent] prompt:", prompt.slice(0, 200));
    console.log("[agent] model:", modelId);
    await session.prompt(prompt);

    const messageCount = session.messages.length;
    console.log("[agent] messages in session:", messageCount);
    for (const msg of session.messages) {
      const content = "content" in msg ? JSON.stringify(msg.content)?.slice(0, 200) : "N/A";
      console.log(`[agent]   role=${msg.role} content=${content}`);
    }

    logUsage(session.messages);

    const result = session.getLastAssistantText() || "";
    console.log("[agent] result length:", result.length);
    return result;
  } finally {
    session.dispose();
  }
}

function createSessionManager(sessionId?: string): SessionManager {
  if (!sessionId) return SessionManager.inMemory();

  const sessionsDir = join(projectDir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  return SessionManager.open(join(sessionsDir, `${sessionId}.jsonl`));
}

function buildPrompt(threadContent: string, repo?: string, dryRun?: boolean): string {
  const parts: string[] = [];

  if (dryRun) {
    parts.push("IMPORTANT: Do not execute any commands. Just describe what you would do.\n");
  }
  if (repo) {
    parts.push(`Target repository: \`${repo}\``);
  }

  parts.push("## Slack Thread\n");
  parts.push(`<slack-thread>\n${threadContent}\n</slack-thread>`);

  return parts.join("\n");
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

function logUsage(messages: any[]): void {
  let totalCost = 0;
  let totalTokens = 0;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.usage) {
      totalCost += msg.usage.cost?.total ?? 0;
      totalTokens += msg.usage.totalTokens ?? 0;
    }
  }

  console.log(`[agent] done — ${totalTokens} tokens, $${totalCost.toFixed(4)}`);
}

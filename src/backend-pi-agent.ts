import { readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
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
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentBackend, BackendConfig, BackendRunOptions, BackendRunResult } from "./backend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

const PROTECTED_PREFIXES = ["src/", "test/", "node_modules/"];
const PROTECTED_FILES = ["package.json", "package-lock.json", "tsconfig.json", ".auth.json"];

function isProtectedPath(absolutePath: string): boolean {
  const abs = resolve(absolutePath);
  const rel = relative(projectDir, abs);
  if (rel.startsWith("..") || rel === abs) return false;
  for (const prefix of PROTECTED_PREFIXES) {
    if (rel.startsWith(prefix) || rel === prefix.slice(0, -1)) return true;
  }
  for (const file of PROTECTED_FILES) {
    if (rel === file) return true;
  }
  if (/^\.env/.test(rel)) return true;
  return false;
}

// AgentTool generic requires TSchema, which has no common base — use `any` for the heterogeneous array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createGuardedTools(cwd: string): AgentTool<any>[] {
  const read = createReadTool(cwd);

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

  const guardedEditOps: EditOperations = {
    readFile: (absolutePath: string) => readFile(absolutePath),
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

  const WRITE_PATTERNS = [">", ">>", "tee ", "cp ", "mv ", "rm ", "sed -i", "chmod ", "chown "];
  const bash = createBashTool(cwd, {
    spawnHook(ctx: BashSpawnContext) {
      const cmd = ctx.command;
      for (const pattern of WRITE_PATTERNS) {
        if (!cmd.includes(pattern)) continue;
        for (const prefix of PROTECTED_PREFIXES) {
          const prefixName = prefix.slice(0, -1);
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
        if (/(^|\s|\/)(\.\/)?\.env/.test(cmd) || cmd.includes(join(projectDir, ".env"))) {
          throw new Error("Blocked: bash command appears to write to a .env file.");
        }
      }
      return ctx;
    },
  });

  return [read, bash, edit, write];
}

// Auth modes (checked in order):
//   1. ANTHROPIC_API_KEY env var -- API key or setup-token, used directly
//   2. .auth.json file -- from `claude setup-token` or manual copy
// Both API keys (sk-ant-api-...) and setup-tokens (sk-ant-oat01-...) work.

let authStorage: AuthStorage | null = null;
const authPath = join(projectDir, ".auth.json");

function initAuth(apiKey?: string): void {
  authStorage = AuthStorage.create(authPath);

  if (apiKey) {
    authStorage.setRuntimeApiKey("anthropic", apiKey);
    const isSetupToken = apiKey.startsWith("sk-ant-oat01-");
    console.log("[backend-pi] Using %s from env", isSetupToken ? "setup-token" : "API key");
  } else if (existsSync(authPath)) {
    console.log("[backend-pi] Using .auth.json");
  } else {
    throw new Error(
      "No auth available. Either:\n" +
      "  1. Set ANTHROPIC_API_KEY env var (API key or setup-token)\n" +
      "  2. Run `claude setup-token`, copy .auth.json to the project root\n",
    );
  }
}

function createMemoryExtension(content: string): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => ({
      systemPrompt: event.systemPrompt + "\n\n" + content,
    }));
  };
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

export class PiAgentBackend implements AgentBackend {
  private model = "claude-sonnet-4-5";
  private sessionDir: string | null = null;
  private memoryDir: string | null = null;
  private sessions = new Map<string, { session: AgentSession; manager: SessionManager }>();

  async init(config: BackendConfig): Promise<void> {
    if (config.githubToken) process.env.GITHUB_TOKEN = config.githubToken;
    this.model = config.model || "claude-sonnet-4-5";
    this.memoryDir = config.memoryDir ?? null;

    this.sessionDir = join(tmpdir(), "claw-sessions");
    mkdirSync(this.sessionDir, { recursive: true });

    initAuth(config.anthropicApiKey);
    console.log("[backend-pi] Initialized (model: %s)", this.model);
  }

  async run(options: BackendRunOptions): Promise<BackendRunResult> {
    if (!authStorage) throw new Error("PiAgentBackend not initialized");

    const { sessionManager, isResumed } = this.resolveSession(options.sessionId);
    const { session } = await this.createSession(options.model, options.systemPrompt ?? "", sessionManager);

    try {
      if (options.onTextDelta) {
        const onDelta = options.onTextDelta;
        session.subscribe((event: AgentSessionEvent) => {
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            onDelta(event.assistantMessageEvent.delta);
          }
        });
      }

      await session.prompt(options.prompt);
      const rawResponse = session.getLastAssistantText() || "";
      sessionManager.appendCustomEntry("slack_last_seen_ts", { ts: options.sessionId });

      const usedTools = hasToolCalls(session.messages);
      const { cost, tokens } = computeUsage(session.messages);
      this.sessions.set(options.sessionId, { session, manager: sessionManager });

      return {
        text: rawResponse,
        sessionId: options.sessionId,
        tokens,
        cost,
        usedTools,
      };
    } catch (err) {
      session.dispose();
      throw err;
    }
  }

  /** Run a follow-up prompt on an existing session (used for memory save). */
  async runFollowUp(sessionId: string, prompt: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      console.warn("[backend-pi] No session found for follow-up: %s", sessionId);
      return;
    }

    const timer = setTimeout(() => {
      console.warn("[backend-pi] Follow-up timed out after 60s");
      entry.session.abort().catch(() => {});
    }, 60_000);

    try {
      await entry.session.prompt(prompt);
    } catch (err) {
      console.error("[backend-pi] Follow-up failed:", err);
    } finally {
      clearTimeout(timer);
    }
  }

  disposeSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.session.dispose();
      this.sessions.delete(sessionId);
    }
  }

  private resolveSession(threadTs: string): { sessionManager: SessionManager; isResumed: boolean } {
    if (!this.sessionDir) {
      return { sessionManager: SessionManager.inMemory(), isResumed: false };
    }

    const sessionPath = join(this.sessionDir, `${threadTs}.jsonl`);
    const isResumed = existsSync(sessionPath);

    try {
      return { sessionManager: SessionManager.open(sessionPath, this.sessionDir), isResumed };
    } catch (err) {
      console.error("[backend-pi] Corrupt session file, starting fresh:", err);
      try { unlinkSync(sessionPath); } catch {}
      return { sessionManager: SessionManager.open(sessionPath, this.sessionDir), isResumed: false };
    }
  }

  private async createSession(modelId: string, memoryContent: string, sessionManager: SessionManager) {
    const systemPrompt = readFileSync(join(projectDir, "prompts/system.md"), "utf-8").trim();
    const modelRegistry = new ModelRegistry(authStorage!);
    const model = modelRegistry.find("anthropic", modelId);
    if (!model) throw new Error(`Model "anthropic/${modelId}" not found`);

    const cwd = process.cwd();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      additionalSkillPaths: [
        join(projectDir, "skills"),
        ...(this.memoryDir ? [join(this.memoryDir, "skills")] : []),
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
}

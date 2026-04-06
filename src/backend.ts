import { ClaudeCliBackend } from "./agent-cli/index.js";
import { PiAgentBackend } from "./agent-pi/index.js";

export interface BackendConfig {
  githubToken?: string;
  model?: string;
  memoryDir?: string;
  slackBotToken?: string;
  // pi-agent specific
  anthropicApiKey?: string;
  // cli specific — long-lived token from `claude setup-token`
  anthropicSetupToken?: string;
}

export interface BackendRunOptions {
  prompt: string;
  model: string;
  sessionId: string;
  isResume: boolean;
  systemPrompt?: string;
  cwd: string;
  env?: Record<string, string>;
  onTextDelta?: (delta: string) => void;
}

export interface BackendRunResult {
  text: string;
  sessionId: string;
  tokens: number;
  cost: number;
  usedTools: boolean;
}

export interface AgentBackend {
  init(config: BackendConfig): Promise<void>;
  run(options: BackendRunOptions): Promise<BackendRunResult>;
  afterRun?(): Promise<void>;
  isKnownSession?(sessionId: string): boolean;
  disposeSession?(sessionId: string): void;
  runFollowUp?(sessionId: string, prompt: string): Promise<void>;
}

export type BackendType = "pi-agent" | "cli";

export function createBackend(type: BackendType): AgentBackend {
  if (type === "cli") return new ClaudeCliBackend();
  return new PiAgentBackend();
}

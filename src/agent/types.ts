export interface AgentProviderConfig {
  githubToken?: string;
  model?: string;
  memoryDir?: string;
  slackBotToken?: string;
  // pi-agent specific
  anthropicApiKey?: string;
  // cli specific — long-lived token from `claude setup-token`
  anthropicSetupToken?: string;
}

export interface AgentRunOptions {
  prompt: string;
  model: string;
  sessionId: string;
  isResume: boolean;
  systemPrompt?: string;
  cwd: string;
  env?: Record<string, string>;
  onTextDelta?: (delta: string) => void;
}

export interface AgentRunResult {
  text: string;
  sessionId: string;
  tokens: number;
  cost: number;
  usedTools: boolean;
}

export interface AgentProvider {
  init(config: AgentProviderConfig): Promise<void>;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
  isKnownSession?(sessionId: string): boolean;
  disposeSession?(sessionId: string): void;
  runFollowUp?(sessionId: string, prompt: string): Promise<void>;
}

export type AgentProviderType = "pi-agent" | "cli";

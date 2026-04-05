import { createHash } from "node:crypto";
import type { AgentBackend, BackendConfig, BackendRunOptions, BackendRunResult } from "./backend.js";
import { runClaude, estimateCost, SessionExpiredError } from "./claude-process.js";

// Claude CLI requires UUIDs for session IDs, but Slack uses threadTs (e.g. "1712345678.123456").
// Derive a deterministic UUID from the threadTs so resume works across calls.

function toClaudeSessionId(sessionId: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return sessionId;
  }
  const hash = createHash("sha256").update(sessionId).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

export class ClaudeCliBackend implements AgentBackend {
  private knownSessions = new Set<string>();
  private model = "claude-sonnet-4-5";
  private slackBotToken?: string;
  private setupToken?: string;

  async init(config: BackendConfig): Promise<void> {
    this.model = config.model || "claude-sonnet-4-5";
    this.slackBotToken = config.slackBotToken;
    this.setupToken = config.anthropicSetupToken;
    if (config.githubToken) process.env.GITHUB_TOKEN = config.githubToken;

    if (!this.setupToken) {
      throw new Error(
        "CLI backend requires ANTHROPIC_SETUP_TOKEN env var.\n" +
        "Run `claude setup-token` on your machine and set the token as ANTHROPIC_SETUP_TOKEN.",
      );
    }

    console.log("[backend-cli] Initialized (model: %s)", this.model);
  }

  async run(options: BackendRunOptions): Promise<BackendRunResult> {
    const claudeSessionId = toClaudeSessionId(options.sessionId);
    const env = this.buildEnv(options.env);

    try {
      return await this.executeRun(options, claudeSessionId, options.isResume, env);
    } catch (err) {
      if (err instanceof SessionExpiredError && options.isResume) {
        console.warn("[backend-cli] Session expired, starting fresh for %s", options.sessionId);
        this.knownSessions.delete(options.sessionId);
        return await this.executeRun(options, claudeSessionId, false, env);
      }
      throw err;
    }
  }

  isKnownSession(sessionId: string): boolean {
    return this.knownSessions.has(sessionId);
  }

  disposeSession(_sessionId: string): void {
    // No-op for CLI backend — Claude CLI manages its own sessions.
    // We keep knownSessions intact so subsequent messages resume correctly.
  }

  private buildEnv(base?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = { ...base };
    if (this.slackBotToken) env.SLACK_BOT_TOKEN = this.slackBotToken;
    if (this.setupToken) env.CLAUDE_CODE_OAUTH_TOKEN = this.setupToken;
    return env;
  }

  private async executeRun(
    options: BackendRunOptions,
    claudeSessionId: string,
    isResume: boolean,
    env: Record<string, string>,
  ): Promise<BackendRunResult> {
    const result = await runClaude({
      prompt: options.prompt,
      model: options.model,
      systemPrompt: options.systemPrompt,
      sessionId: claudeSessionId,
      isResume,
      cwd: options.cwd,
      env,
      onTextDelta: options.onTextDelta,
    });

    this.knownSessions.add(options.sessionId);

    const cost = estimateCost(options.model, result.usage.inputTokens, result.usage.outputTokens);

    return {
      text: result.text,
      sessionId: options.sessionId,
      tokens: result.usage.inputTokens + result.usage.outputTokens,
      cost,
      usedTools: result.usedTools,
    };
  }
}

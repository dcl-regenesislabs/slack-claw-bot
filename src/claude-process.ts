import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface ClaudeRunOptions {
  prompt: string;
  model: string;
  systemPrompt?: string;
  sessionId: string;
  isResume: boolean;
  cwd: string;
  env?: Record<string, string>;
  onTextDelta?: (delta: string) => void;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ClaudeRunResult {
  text: string;
  sessionId: string;
  usage: { inputTokens: number; outputTokens: number };
  usedTools: boolean;
}

const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match, then prefix match
  const pricing =
    PRICING_PER_MILLION[model] ??
    Object.entries(PRICING_PER_MILLION).find(([key]) => model.startsWith(key))?.[1];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

interface ParseState {
  lineBuffer: string;
  text: string;
  sessionId: string | undefined;
  inputTokens: number;
  outputTokens: number;
  usedTools: boolean;
  finalResult: string | undefined;
  error: string | undefined;
}

function createParseState(): ParseState {
  return {
    lineBuffer: "",
    text: "",
    sessionId: undefined,
    inputTokens: 0,
    outputTokens: 0,
    usedTools: false,
    finalResult: undefined,
    error: undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function handleParsedLine(
  state: ParseState,
  parsed: Record<string, unknown>,
  onTextDelta?: (delta: string) => void,
): void {
  if (typeof parsed.session_id === "string" && parsed.session_id.trim()) {
    state.sessionId = parsed.session_id.trim();
  }

  if (isRecord(parsed.usage)) {
    const usage = parsed.usage;
    if (typeof usage.input_tokens === "number") state.inputTokens = usage.input_tokens;
    if (typeof usage.output_tokens === "number") state.outputTokens = usage.output_tokens;
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";

  if (typeof parsed.error === "string" && parsed.error) {
    state.error = parsed.error;
  }

  // Detect tool use from assistant messages (type: "assistant" with content[].type === "tool_use")
  if (type === "assistant" && isRecord(parsed.message)) {
    const content = (parsed.message as Record<string, unknown>).content;
    if (Array.isArray(content) && content.some((c) => isRecord(c) && c.type === "tool_use")) {
      state.usedTools = true;
    }
  }

  if (type === "result") {
    if (parsed.is_error === true && typeof parsed.result === "string") {
      state.error = state.error || parsed.result.trim();
    }
    if (typeof parsed.result === "string") {
      state.finalResult = parsed.result.trim();
    }
    return;
  }

  if (type === "stream_event" && isRecord(parsed.event)) {
    const event = parsed.event;
    const eventType = typeof event.type === "string" ? event.type : "";

    if (eventType === "content_block_delta" && isRecord(event.delta)) {
      const delta = event.delta;
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        state.text += delta.text;
        onTextDelta?.(delta.text);
      }
      return;
    }

    if (eventType === "content_block_start" && isRecord(event.content_block)) {
      if (event.content_block.type === "tool_use") {
        state.usedTools = true;
      }
      return;
    }
  }
}

function flushLines(state: ParseState, onTextDelta?: (delta: string) => void, flushPartial = false): void {
  while (true) {
    const idx = state.lineBuffer.indexOf("\n");
    if (idx < 0) break;
    const line = state.lineBuffer.slice(0, idx).trim();
    state.lineBuffer = state.lineBuffer.slice(idx + 1);
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) {
        handleParsedLine(state, parsed, onTextDelta);
      }
    } catch {
      // Skip malformed lines
    }
  }
  if (flushPartial) {
    const tail = state.lineBuffer.trim();
    state.lineBuffer = "";
    if (tail) {
      try {
        const parsed = JSON.parse(tail);
        if (isRecord(parsed)) {
          handleParsedLine(state, parsed, onTextDelta);
        }
      } catch {
        // Skip
      }
    }
  }
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const {
    prompt,
    model,
    systemPrompt,
    sessionId,
    isResume,
    cwd,
    env,
    onTextDelta,
    timeoutMs = 300_000,
    noOutputTimeoutMs = 120_000,
    signal,
  } = options;

  const args = buildArgs({ model, systemPrompt, sessionId, isResume });

  const child = spawn("claude", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : undefined,
  });

  child.stdin.write(prompt);
  child.stdin.end();

  const state = createParseState();
  let stderr = "";

  if (signal) {
    const onAbort = () => killProcess(child);
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("close", () => signal.removeEventListener("abort", onAbort));
  }

  let overallTimer: NodeJS.Timeout | null = null;
  let noOutputTimer: NodeJS.Timeout | null = null;
  let timedOut = false;
  let timeoutReason = "";

  const clearTimers = () => {
    if (overallTimer) { clearTimeout(overallTimer); overallTimer = null; }
    if (noOutputTimer) { clearTimeout(noOutputTimer); noOutputTimer = null; }
  };

  const resetNoOutputTimer = () => {
    if (noOutputTimer) clearTimeout(noOutputTimer);
    if (noOutputTimeoutMs > 0) {
      noOutputTimer = setTimeout(() => {
        timedOut = true;
        timeoutReason = `No output for ${Math.round(noOutputTimeoutMs / 1000)}s`;
        killProcess(child);
      }, noOutputTimeoutMs);
    }
  };

  overallTimer = setTimeout(() => {
    timedOut = true;
    timeoutReason = `Overall timeout (${Math.round(timeoutMs / 1000)}s)`;
    killProcess(child);
  }, timeoutMs);

  resetNoOutputTimer();

  child.stdout.on("data", (chunk: Buffer) => {
    resetNoOutputTimer();
    const text = chunk.toString();
    if (process.env.DEBUG) {
      for (const line of text.split("\n")) {
        if (line.trim()) console.log("[claude-raw]", line.trim().slice(0, 500));
      }
    }
    state.lineBuffer += text;
    flushLines(state, onTextDelta);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (process.env.DEBUG && text.trim()) {
      console.log("[claude-stderr]", text.trim().slice(0, 500));
    }
    stderr += text;
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, sig) => resolve({ code, signal: sig }));
  });

  clearTimers();
  flushLines(state, onTextDelta, true);

  if (timedOut) {
    throw new Error(`Claude CLI timed out: ${timeoutReason}`);
  }

  if (signal?.aborted) {
    throw new Error("Claude CLI aborted");
  }

  if (exit.code !== 0 || state.error) {
    const errText = state.error || stderr.trim() || state.finalResult || "CLI failed";
    if (isResume && isSessionExpiredError(errText)) {
      throw new SessionExpiredError(errText);
    }
    throw new Error(`Claude CLI exited with code ${exit.code}: ${errText}`);
  }

  const resultText = state.finalResult ?? state.text;
  if (process.env.DEBUG) {
    console.log(`[claude-parse] finalResult=${state.finalResult?.length ?? "null"} text=${state.text.length} error=${state.error ?? "null"} resultText=${resultText.length}`);
  }

  return {
    text: resultText,
    sessionId: state.sessionId ?? sessionId,
    usage: {
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    },
    usedTools: state.usedTools,
  };
}

function buildArgs(opts: {
  model: string;
  systemPrompt?: string;
  sessionId: string;
  isResume: boolean;
}): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--model", opts.model,
  ];

  if (opts.isResume) {
    args.push("--resume", opts.sessionId);
  } else {
    args.push("--session-id", opts.sessionId);
    if (opts.systemPrompt) {
      args.push("--append-system-prompt", opts.systemPrompt);
    }
  }

  return args;
}

function killProcess(child: ChildProcessWithoutNullStreams): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}

function isSessionExpiredError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("session not found") ||
    lower.includes("conversation expired") ||
    lower.includes("session expired") ||
    lower.includes("invalid session")
  );
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

# Migrating a Slack AI bot from pi-agent to Claude CLI

This guide explains how to replace `@mariozechner/pi-coding-agent` (which uses OAuth API calls) with spawning `claude -p` as a subprocess. This is needed because Anthropic is deprecating the OAuth flow that pi-agent relies on.

Reference implementation: https://github.com/dcl-regenesislabs/slack-claw-bot/pull/53

## What changes

| Before (pi-agent) | After (Claude CLI) |
|---|---|
| `@mariozechner/pi-coding-agent` SDK | `claude -p` subprocess |
| OAuth refresh tokens + `.auth.json` | `ANTHROPIC_SETUP_TOKEN` env var |
| Redis for token rotation across deploys | Not needed — static token |
| `SessionManager` JSONL files | Claude CLI's own session store |
| `createAgentSession` + `session.prompt()` | `spawn("claude", args)` + JSONL parsing |
| `DefaultResourceLoader` loads skills | Skills copied to `.claude/skills/` in workspace |
| Guarded tools via code wrappers | `CLAUDE.md` in workspace directory |

## Architecture

```
ANTHROPIC_SETUP_TOKEN (env var)
  → passed as CLAUDE_CODE_OAUTH_TOKEN to subprocess
  → claude -p reads it directly (no credential files needed)

AgentBackend interface (src/backend.ts)
  ├── ClaudeCliBackend (default)
  │   └── spawns: claude -p --output-format stream-json --permission-mode bypassPermissions
  └── PiAgentBackend (fallback, behind AGENT_BACKEND=pi-agent)
      └── uses: @mariozechner/pi-coding-agent SDK

agent.ts (thin dispatcher)
  → loads memory → builds prompt → backend.run() → memory save
```

## Step-by-step

### 1. Get a setup token

On your local machine (not the server):

```bash
claude setup-token
```

This gives you a `sk-ant-oat01-...` token valid for ~1 year. Set it as `ANTHROPIC_SETUP_TOKEN` in your deployment env.

### 2. Auth — the key insight

The `claude` CLI checks `CLAUDE_CODE_OAUTH_TOKEN` env var before looking at credential files or keychain. Pass the setup token as this env var to the subprocess:

```typescript
const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: setupToken };
spawn("claude", args, { env });
```

No `~/.claude/.credentials.json` seeding needed. No Redis. No token rotation. Works on fresh deploys because the token comes from the env var.

### 3. Spawning claude -p

```typescript
const args = [
  "-p",                              // print mode (non-interactive)
  "--output-format", "stream-json",  // machine-readable JSONL output
  "--verbose",
  "--permission-mode", "bypassPermissions",
  "--model", model,
];

// New session:
args.push("--session-id", sessionId);
args.push("--append-system-prompt", systemPrompt);

// Resume existing session:
args.push("--resume", sessionId);
```

- Prompt goes via **stdin** (write then close)
- Response comes as **JSONL on stdout**
- Session IDs must be **valid UUIDs** — if using Slack threadTs, hash it to a deterministic UUID

### 4. Parsing JSONL output

The Claude CLI emits these event types:

```jsonc
// Text delta (streaming)
{ "type": "stream_event", "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Hello" } } }

// Tool use detection
{ "type": "stream_event", "event": { "type": "content_block_start", "content_block": { "type": "tool_use" } } }

// Final result
{ "type": "result", "result": "Full response text", "session_id": "uuid", "usage": { "input_tokens": 100, "output_tokens": 50 } }

// Error
{ "type": "result", "is_error": true, "result": "Error message" }
// or: { "type": "assistant", "error": "authentication_failed" }
```

Parse line by line. Buffer partial lines. Flush remaining on process exit.

### 5. Session resume

- First message in a thread: `--session-id <uuid>` + `--append-system-prompt <prompt>`
- Follow-up messages: `--resume <uuid>` (no system prompt — Claude already has it)
- Track known sessions in memory (`Set<string>`)
- **Do NOT delete session tracking on dispose** — the Claude CLI session persists, and removing it causes "Session ID already in use" errors on the next message

### 6. Memory save

After the main response, do a second `claude -p --resume <sessionId>` call with the memory save prompt. Claude has the full conversation context from the first turn, so it knows what to save.

### 7. Skills

Claude CLI discovers project-scoped skills from `.claude/skills/<name>/SKILL.md` in the working directory. Copy your skill files there on startup:

```typescript
// In your workspace setup:
cpSync(
  join(projectDir, "skills", skillName),
  join(workspaceDir, ".claude", "skills", skillName),
  { recursive: true },
);
```

### 8. Tool restrictions

With pi-agent you had code-level guarded tools. With Claude CLI, use a `CLAUDE.md` file in the working directory:

```markdown
## Tool restrictions
You MUST NOT write to, edit, or delete:
- src/, test/, node_modules/
- package.json, .env*, .auth.json
```

### 9. Workspace isolation

Run Claude in a dedicated workspace directory (e.g. `/tmp/claw-workspace/`) instead of your project root. This prevents Claude from modifying your bot's source code. Symlink or copy what Claude needs access to (skills, memory).

### 10. Dockerfile

Add Claude CLI to your Docker image and run as non-root (Claude refuses `--permission-mode bypassPermissions` as root):

```dockerfile
RUN npm install -g @anthropic-ai/claude-code
RUN useradd -m -s /bin/bash bot
USER bot
```

### 11. Keep pi-agent as fallback

Use an `AGENT_BACKEND` env var to switch between backends:

```typescript
// backend.ts
export interface AgentBackend {
  init(config: BackendConfig): Promise<void>;
  run(options: BackendRunOptions): Promise<BackendRunResult>;
  isKnownSession?(sessionId: string): boolean;
  disposeSession?(sessionId: string): void;
  runFollowUp?(sessionId: string, prompt: string): Promise<void>;
}
```

Default to `cli`. Set `AGENT_BACKEND=pi-agent` for Codex or as a rollback.

## Gotchas we hit

1. **Session IDs must be UUIDs** — Slack threadTs like `1712345678.123456` gets rejected. Hash to a deterministic UUID.
2. **Don't dispose CLI sessions** — the CLI manages its own session store. Removing from your tracking causes "already in use" errors on resume.
3. **Root user blocked** — Claude CLI refuses `bypassPermissions` as root. Use a non-root user in Docker.
4. **Auth errors are in stdout, not stderr** — the JSONL stream contains `"error": "authentication_failed"`, while stderr is just npm notices. Parse errors from the JSONL, not stderr.
5. **Skills aren't auto-discovered from arbitrary paths** — they must be in `.claude/skills/` relative to the working directory.
6. **`--append-system-prompt` only on first message** — on `--resume`, Claude already has the system prompt from the initial session.

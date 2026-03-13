import "dotenv/config";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { initAgent, runAgent, detectReviewModel } from "./agent.js";
import { resolveMemoryDir } from "./memory.js";

const dryRun = process.argv.includes("--dry-run");
const positionalArgs = process.argv.slice(2).filter((a) => a !== "--dry-run");

let memoryDir: string | undefined;
try {
  memoryDir = resolveMemoryDir(process.env.MEMORY_REPO);
} catch (err) {
  console.error("[cli] Failed to set up memory:", err);
}

await initAgent({
  anthropicOAuthRefreshToken: process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN,
  githubToken: process.env.GITHUB_TOKEN,
  model: process.env.MODEL,
  memoryDir,
});

function streamingEvents(): EventEmitter {
  const events = new EventEmitter();
  events.on("text", (delta: string) => process.stdout.write(delta));
  return events;
}

function makeRunOptions(content: string, threadTs?: string) {
  const ts = threadTs || `cli-${Date.now()}`;
  return {
    threadTs: ts,
    eventTs: ts,
    username: "cli-user",
    newMessage: content,
    fetchThread: async () => content,
    fetchThreadSince: async () => "",
    dryRun,
    model: detectReviewModel(content),
    events: streamingEvents(),
  };
}

if (positionalArgs.length > 0) {
  const content = positionalArgs.join(" ");
  if (dryRun) console.log("Dry run enabled — agent will not execute commands");

  try {
    await runAgent(makeRunOptions(content));
    console.log();
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  console.log("CLI test mode");
  if (dryRun) console.log("Dry run enabled — agent will not execute commands");
  console.log("Type your message (multi-line: end with an empty line):\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  const replThreadTs = `cli-${Date.now()}`;

  rl.on("line", (line) => {
    if (line === "" && lines.length > 0) {
      const content = lines.join("\n");
      lines.length = 0;
      handleInput(content);
    } else {
      lines.push(line);
    }
  });

  rl.on("close", () => process.exit(0));

  async function handleInput(content: string) {
    rl.pause();
    console.log("\n--- Agent running ---\n");

    try {
      await runAgent(makeRunOptions(content, replThreadTs));
      console.log("\n\n--- Done ---\n");
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }

    console.log("Type your next message (end with an empty line):\n");
    rl.resume();
  }
}

import "dotenv/config";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { initAgent, runAgent } from "./agent.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const positionalArgs = process.argv.slice(2).filter((a) => a !== "--dry-run");

await initAgent({
  anthropicApiKey: apiKey,
  githubToken: process.env.GITHUB_TOKEN,
  model: process.env.MODEL,
});

function streamingEvents(): EventEmitter {
  const events = new EventEmitter();
  events.on("text", (delta: string) => process.stdout.write(delta));
  return events;
}

if (positionalArgs.length > 0) {
  // One-shot mode
  const threadContent = positionalArgs.join(" ");
  if (dryRun) console.log("Dry run enabled — agent will not execute commands");

  try {
    await runAgent({ threadContent, dryRun, events: streamingEvents() });
    console.log();
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  // Interactive REPL mode
  console.log("CLI test mode");
  if (dryRun) console.log("Dry run enabled — agent will not execute commands");
  console.log("Type your message (multi-line: end with an empty line):\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];

  rl.on("line", (line) => {
    if (line === "" && lines.length > 0) {
      const threadContent = lines.join("\n");
      lines.length = 0;
      handleInput(threadContent);
    } else {
      lines.push(line);
    }
  });

  rl.on("close", () => process.exit(0));

  async function handleInput(threadContent: string) {
    rl.pause();
    console.log("\n--- Agent running ---\n");

    try {
      await runAgent({ threadContent, dryRun, events: streamingEvents() });
      console.log("\n\n--- Done ---\n");
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }

    console.log("Type your next message (end with an empty line):\n");
    rl.resume();
  }
}

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

initAgent({
  anthropicApiKey: apiKey,
  githubToken: process.env.GITHUB_TOKEN,
  model: process.env.MODEL,
});

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

  const events = new EventEmitter();
  events.on("text", (delta: string) => {
    process.stdout.write(delta);
  });

  try {
    await runAgent({ threadContent, dryRun, events });
    console.log("\n\n--- Done ---\n");
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
  }

  console.log("Type your next message (end with an empty line):\n");
  rl.resume();
}

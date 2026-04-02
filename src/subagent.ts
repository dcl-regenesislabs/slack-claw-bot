import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import {
  createAgentSession,
  createReadOnlyTools,
  createCodingTools,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  parseFrontmatter,
  type AuthStorage,
  type ModelRegistry,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

const MAX_CONCURRENCY = 4;
const AGENT_TIMEOUT_MS = 7 * 60 * 1000; // 7 minutes per sub-agent

export interface AgentDef {
  name: string;
  description: string;
  model: string | undefined;
  tools: string[] | undefined;
  systemPrompt: string;
  filePath: string;
}

export function discoverAgents(agentsDir: string): AgentDef[] {
  const agents: AgentDef[] = [];

  function scanDir(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
          if (!frontmatter.name || !frontmatter.description) continue;
          const tools = frontmatter.tools
            ?.split(",")
            .map((t: string) => t.trim())
            .filter(Boolean);
          agents.push({
            name: frontmatter.name,
            description: frontmatter.description,
            model: frontmatter.model === "inherit" ? undefined : frontmatter.model,
            tools: tools && tools.length > 0 ? tools : undefined,
            systemPrompt: body,
            filePath: fullPath,
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  scanDir(agentsDir);
  return agents;
}

export function resolveModel(
  agentModel: string | undefined,
  parentModelId: string,
  modelRegistry: ModelRegistry,
) {
  const modelId = agentModel || parentModelId;
  // Map short names to full IDs
  const modelMap: Record<string, string> = {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };
  const resolvedId = modelMap[modelId] || modelId;
  return modelRegistry.find("anthropic", resolvedId);
}

async function runSingleAgent(
  agent: AgentDef,
  task: string,
  cwd: string,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  parentModelId: string,
): Promise<{ agent: string; result: string; error?: string }> {
  const model = resolveModel(agent.model, parentModelId, modelRegistry);
  if (!model) {
    return { agent: agent.name, result: "", error: `Model not found for agent "${agent.name}"` };
  }

  // Research agents get read-only tools; worker agents get full coding tools
  const isReadOnly = !agent.tools || agent.tools.every((t) =>
    ["read", "grep", "find", "ls", "bash"].includes(t),
  );
  const tools = isReadOnly ? createReadOnlyTools(cwd) : createCodingTools(cwd);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    systemPrompt: agent.systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    model,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
    resourceLoader,
    tools,
  });

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent "${agent.name}" timed out after ${AGENT_TIMEOUT_MS / 1000}s`)), AGENT_TIMEOUT_MS),
    );
    await Promise.race([session.prompt(`Task: ${task}`), timeoutPromise]);
    const text = session.getLastAssistantText() || "";
    return { agent: agent.name, result: text };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Return partial result if available (agent may have produced some output before timeout)
    const partial = session.getLastAssistantText() || "";
    return { agent: agent.name, result: partial, error: msg };
  } finally {
    session.dispose();
  }
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
): Promise<unknown[]> {
  const results: unknown[] = new Array(items.length);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface SubagentConfig {
  agentsDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  parentModelId: string;
}

export function createSubagentTool(config: SubagentConfig): ToolDefinition {
  const agents = discoverAgents(config.agentsDir);
  const agentNames = agents.map((a) => a.name);
  console.log(`[subagent] Discovered ${agents.length} agents: ${agentNames.join(", ")}`);

  return {
    name: "subagent",
    label: "Sub-agent",
    description: [
      "Delegate tasks to specialized sub-agents that run in isolated sessions.",
      "Each sub-agent has its own context window and tools.",
      "Multiple tasks run in parallel (up to 4 concurrent).",
      `Available agents: ${agentNames.join(", ")}`,
    ].join(" "),
    parameters: Type.Object({
      cwd: Type.String({ description: "Working directory for sub-agents (the repo being analyzed)" }),
      tasks: Type.Array(
        Type.Object({
          agent: Type.String({ description: "Agent name" }),
          task: Type.String({ description: "Task description to delegate" }),
        }),
        { description: "Tasks to run (parallel if multiple)" },
      ),
    }),
    execute: async (_toolCallId, rawParams, _signal, _onUpdate, _ctx) => {
      const params = rawParams as { cwd: string; tasks: { agent: string; task: string }[] };
      const results: { agent: string; result: string; error?: string }[] = [];

      const taskItems = params.tasks.map((t) => {
        const agentDef = agents.find((a) => a.name === t.agent) || null;
        return { agent: t.agent, task: t.task, agentDef };
      });

      // Report unknown agents immediately
      for (const item of taskItems) {
        if (!item.agentDef) {
          console.warn(`[subagent] Unknown agent requested: "${item.agent}". Available: ${agentNames.join(", ")}`);
          results.push({
            agent: item.agent,
            result: "",
            error: `Unknown agent "${item.agent}". Available: ${agentNames.join(", ")}`,
          });
        }
      }

      const validTasks = taskItems.filter(
        (t): t is typeof t & { agentDef: AgentDef } => t.agentDef !== null,
      );

      console.log(`[subagent] Running ${validTasks.length} agent(s) in parallel (max ${MAX_CONCURRENCY} concurrent)`);

      const agentResults = await runWithConcurrency(
        validTasks,
        MAX_CONCURRENCY,
        async (item) => {
          const taskPreview = item.task.length > 120 ? item.task.slice(0, 120) + "..." : item.task;
          console.log(`[subagent] Starting: ${item.agent} in ${params.cwd} — task: ${taskPreview}`);
          const t0 = Date.now();
          const result = await runSingleAgent(
            item.agentDef,
            item.task,
            params.cwd,
            config.authStorage,
            config.modelRegistry,
            config.parentModelId,
          );
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`[subagent] Finished: ${item.agent} in ${elapsed}s (${result.result.length} chars${result.error ? ", ERROR: " + result.error : ""})`);
          return result;
        },
      ) as { agent: string; result: string; error?: string }[];

      results.push(...agentResults);

      // Format output
      const output = results
        .map((r) => {
          if (r.error) {
            return `## Agent: ${r.agent}\n\n**ERROR:** ${r.error}`;
          }
          return `## Agent: ${r.agent}\n\n${r.result}`;
        })
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text: output }],
        details: {},
      };
    },
  };
}

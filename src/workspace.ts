import { existsSync, mkdirSync, symlinkSync, readlinkSync, unlinkSync, writeFileSync, readFileSync, readdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");

const CLAUDE_MD_CONTENT = `# Agent Workspace

## Tool restrictions

You MUST NOT write to, edit, or delete any file outside of this workspace
except for the memory directory paths provided in your system prompt.

Specifically, never modify:
- Any file under the bot's source code directory
- package.json, package-lock.json, tsconfig.json
- .auth.json or any .env* file
- node_modules/

These restrictions are non-negotiable. If a task requires modifying protected
files, refuse and explain why.
`;

function ensureSymlink(target: string, linkPath: string): void {
  if (existsSync(linkPath)) {
    try {
      const current = readlinkSync(linkPath);
      if (current === target) return;
    } catch {
      // Not a symlink — remove and recreate
    }
    try { unlinkSync(linkPath); } catch { /* ignore */ }
  }
  try {
    symlinkSync(target, linkPath);
  } catch (err) {
    console.warn(`[workspace] Failed to symlink ${target} → ${linkPath}:`, (err as Error).message);
  }
}

export function prepareWorkspace(opts: { memoryDir?: string }): string {
  const workspaceDir = join(tmpdir(), "claw-workspace");
  mkdirSync(workspaceDir, { recursive: true });

  // Symlink project skills
  const projectSkills = join(projectDir, "skills");
  if (existsSync(projectSkills)) {
    ensureSymlink(projectSkills, join(workspaceDir, "skills"));
  }

  // Symlink memory skills
  if (opts.memoryDir) {
    const memorySkills = join(opts.memoryDir, "skills");
    if (existsSync(memorySkills)) {
      ensureSymlink(memorySkills, join(workspaceDir, "memory-skills"));
    }
  }

  // Copy skills into .claude/skills/ so Claude CLI discovers them as project-scoped skills
  const claudeSkillsDir = join(workspaceDir, ".claude", "skills");
  const skillSources = [
    join(projectDir, "skills"),
    ...(opts.memoryDir ? [join(opts.memoryDir, "skills")] : []),
  ];
  for (const source of skillSources) {
    if (!existsSync(source)) continue;
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(source, entry.name, "SKILL.md"))) continue;
      cpSync(join(source, entry.name), join(claudeSkillsDir, entry.name), { recursive: true });
    }
  }

  // Write CLAUDE.md for CLI backend
  writeFileSync(join(workspaceDir, "CLAUDE.md"), CLAUDE_MD_CONTENT, "utf-8");

  // Copy system prompt for reference
  const systemPromptSrc = join(projectDir, "prompts", "system.md");
  if (existsSync(systemPromptSrc)) {
    const content = readFileSync(systemPromptSrc, "utf-8");
    writeFileSync(join(workspaceDir, "system.md"), content, "utf-8");
  }

  return workspaceDir;
}

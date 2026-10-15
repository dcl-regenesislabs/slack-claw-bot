import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { getTurnError, isProtectedPath, createGuardedTools } from "../src/agent.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const assistant = (props: Record<string, unknown>): AgentMessage =>
  ({ role: "assistant", content: [], ...props }) as unknown as AgentMessage;

describe("getTurnError", () => {
  it("returns null for a successful turn", () => {
    assert.equal(getTurnError([assistant({ stopReason: "stop" })]), null);
  });

  it("surfaces the errorMessage when the last turn errored", () => {
    const msgs = [assistant({ stopReason: "error", errorMessage: "401 unauthorized" })];
    assert.equal(getTurnError(msgs), "401 unauthorized");
  });

  it("treats an aborted turn as a failure", () => {
    const msgs = [assistant({ stopReason: "aborted" })];
    assert.equal(getTurnError(msgs), "Agent turn aborted with no error detail");
  });

  it("falls back when error detail is missing", () => {
    assert.equal(
      getTurnError([assistant({ stopReason: "error" })]),
      "Agent turn error with no error detail",
    );
  });

  it("only inspects the final assistant turn (retry-then-succeed is ok)", () => {
    const msgs = [
      assistant({ stopReason: "error", errorMessage: "transient" }),
      { role: "user", content: "retry", timestamp: 0 } as unknown as AgentMessage,
      assistant({ stopReason: "stop" }),
    ];
    assert.equal(getTurnError(msgs), null);
  });

  it("returns null when there is no assistant message", () => {
    assert.equal(getTurnError([]), null);
  });
});

describe("isProtectedPath extra protected dirs", () => {
  it("protects paths under an extra dir", () => {
    assert.equal(isProtectedPath("/tmp/claw-memory/schedules/schedules.json", ["/tmp/claw-memory/schedules"]), true);
    assert.equal(isProtectedPath("/tmp/claw-memory/schedules", ["/tmp/claw-memory/schedules"]), true);
    assert.equal(isProtectedPath("/tmp/claw-memory/schedules/../schedules/x.json", ["/tmp/claw-memory/schedules"]), true);
  });

  it("does not protect siblings of an extra dir", () => {
    assert.equal(isProtectedPath("/tmp/claw-memory/shared/MEMORY.md", ["/tmp/claw-memory/schedules"]), false);
    assert.equal(isProtectedPath("/tmp/claw-memory/schedules.json", ["/tmp/claw-memory/schedules"]), false);
  });

  it("keeps project files protected regardless of extra dirs", () => {
    assert.equal(isProtectedPath(join(projectRoot, "src/agent.ts"), []), true);
    assert.equal(isProtectedPath(join(projectRoot, "src/agent.ts"), ["/tmp/whatever"]), true);
  });

  it("normalizes relative extra dirs against cwd", () => {
    assert.equal(isProtectedPath(join(process.cwd(), "some-guarded", "f.txt"), ["some-guarded"]), true);
  });

  it("follows symlinks so a planted link cannot tunnel through the guard", () => {
    const base = mkdtempSync(join(tmpdir(), "guard-test-"));
    try {
      mkdirSync(join(base, "schedules"), { recursive: true });
      writeFileSync(join(base, "schedules", "schedules.json"), "{}", "utf-8");
      symlinkSync(join(base, "schedules", "schedules.json"), join(base, "innocent.json"));
      symlinkSync(join(base, "schedules"), join(base, "alias"));
      assert.equal(isProtectedPath(join(base, "innocent.json"), [join(base, "schedules")]), true);
      assert.equal(isProtectedPath(join(base, "alias", "schedules.json"), [join(base, "schedules")]), true);
      assert.equal(isProtectedPath(join(base, "elsewhere.json"), [join(base, "schedules")]), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// Drives the tools pi actually runs (not the predicates behind them), so a guard that is
// defined but never wired into createGuardedTools fails here.
describe("createGuardedTools", () => {
  const ctx = { sessionManager: { getSessionId: () => "t", getSessionFile: () => undefined } } as never;
  const tools = Object.fromEntries(createGuardedTools(process.cwd()).map((t) => [t.name, t]));
  const text = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? "").join("");
  const bash = async (command: string) => text(await tools.bash.execute("1", { command }, undefined, undefined, ctx));
  const read = async (path: string) => text(await tools.read.execute("2", { path }, undefined, undefined, ctx));

  it("hands the shell only the allowlisted environment", async () => {
    const saved = { SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.GITHUB_TOKEN = "ghp_test";
    try {
      const names = (await bash("env | cut -d= -f1")).split("\n");
      assert.ok(names.includes("PATH"));
      assert.ok(names.includes("GITHUB_TOKEN"));
      assert.ok(!names.includes("SLACK_BOT_TOKEN"));
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  });

  it("refuses credential files through read, edit, and bash, following symlinks", async () => {
    const base = mkdtempSync(join(tmpdir(), "secret-test-"));
    try {
      writeFileSync(join(base, ".auth.json"), "{}", "utf-8");
      writeFileSync(join(base, ".env.production"), "X=1", "utf-8");
      symlinkSync(join(base, ".auth.json"), join(base, "innocent.json"));
      await assert.rejects(read(join(base, ".auth.json")), /Blocked/);
      await assert.rejects(read(join(base, ".env.production")), /Blocked/);
      await assert.rejects(read(join(base, "innocent.json")), /Blocked/);
      await assert.rejects(
        tools.edit.execute("3", { path: join(base, ".auth.json"), edits: [{ oldText: "{}", newText: "" }] }, undefined, undefined, ctx),
        /Blocked/,
      );
      await assert.rejects(bash(`cat ${join(base, ".auth.json")}`), /Blocked/);
      await assert.rejects(bash("cat .env"), /Blocked/);
      await assert.rejects(bash(`base64 "${join(base, ".env.production")}"`), /Blocked/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("still allows ordinary files and commands that merely mention env", async () => {
    const base = mkdtempSync(join(tmpdir(), "secret-test-"));
    try {
      writeFileSync(join(base, "environment.md"), "process.env.X\n", "utf-8");
      assert.match(await read(join(base, "environment.md")), /process\.env\.X/);
      assert.equal((await bash(`grep -c process.env ${join(base, "environment.md")}`)).trim(), "1");
      assert.equal((await bash("printf ok")).trim(), "ok");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

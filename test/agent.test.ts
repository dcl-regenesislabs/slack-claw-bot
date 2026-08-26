import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTurnError, isProtectedPath } from "../src/agent.js";
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
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getTurnError } from "../src/agent.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

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

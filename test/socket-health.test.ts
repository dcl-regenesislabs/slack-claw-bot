import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateSocketHealth, handleSubmissionError } from "../src/slack.js";

describe("evaluateSocketHealth", () => {
  it("reports ok while connected", () => {
    const action = evaluateSocketHealth({ connected: true, lastConnectedAt: 0 }, 999_999, 150_000);
    assert.equal(action.kind, "ok");
  });

  it("reports reconnecting within the grace window", () => {
    const action = evaluateSocketHealth({ connected: false, lastConnectedAt: 100_000 }, 200_000, 150_000);
    assert.deepEqual(action, { kind: "reconnecting", silenceMs: 100_000 });
  });

  it("trips once silence exceeds the limit", () => {
    const action = evaluateSocketHealth({ connected: false, lastConnectedAt: 0 }, 150_000, 150_000);
    assert.deepEqual(action, { kind: "trip", silenceMs: 150_000 });
  });
});

describe("handleSubmissionError", () => {
  it("runs every step even when earlier steps fail", async () => {
    const calls: string[] = [];
    handleSubmissionError(new Error("boom"), {
      label: "test",
      removeReaction: async () => { calls.push("remove"); throw new Error("slack down"); },
      addReaction: async () => { calls.push("add"); throw new Error("slack down"); },
      say: async () => { calls.push("say"); return undefined; },
      threadTs: "1.0",
      auditLog: async () => { calls.push("audit"); return undefined; },
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls, ["remove", "add", "say", "audit"]);
  });

  it("escapes error text sent to Slack", async () => {
    let posted = "";
    handleSubmissionError(new Error("bad <tag> & stuff"), {
      label: "test",
      removeReaction: async () => undefined,
      addReaction: async () => undefined,
      say: async ({ text }) => { posted = text; return undefined; },
      threadTs: "1.0",
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(posted.includes("&lt;tag&gt;"));
    assert.ok(posted.includes("&amp;"));
  });

  it("never rejects even if the say step fails", async () => {
    handleSubmissionError(new Error("boom"), {
      label: "test",
      removeReaction: async () => { throw new Error("a"); },
      addReaction: async () => { throw new Error("b"); },
      say: async () => { throw new Error("c"); },
      threadTs: "1.0",
    });
    await new Promise((r) => setTimeout(r, 10));
    // reaching here without an unhandled rejection is the assertion
    assert.ok(true);
  });
});

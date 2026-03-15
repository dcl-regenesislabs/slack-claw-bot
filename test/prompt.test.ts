import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/prompt.js";

describe("buildPrompt", () => {
  it("wraps content in slack-thread tags", () => {
    const result = buildPrompt("hello world");
    assert.ok(result.includes("<slack-thread>\nhello world\n</slack-thread>"));
  });

  it("includes dry-run notice when dryRun is true", () => {
    const result = buildPrompt("hello", true);
    assert.ok(result.startsWith("IMPORTANT: Do not execute any commands."));
  });

  it("has no dry-run notice when dryRun is false", () => {
    const result = buildPrompt("hello", false);
    assert.ok(!result.includes("IMPORTANT:"));
  });

  it("has no dry-run notice when dryRun is undefined", () => {
    const result = buildPrompt("hello");
    assert.ok(!result.includes("IMPORTANT:"));
  });

  it("preserves multiline content", () => {
    const content = "line one\nline two\nline three";
    const result = buildPrompt(content);
    assert.ok(result.includes(content));
  });

  it("includes triggeredBy when provided", () => {
    const result = buildPrompt("hello", false, "Alice");
    assert.ok(result.includes("Triggered by: Alice"));
  });

  it("omits triggeredBy when not provided", () => {
    const result = buildPrompt("hello");
    assert.ok(!result.includes("Triggered by:"));
  });

  it("wraps content in slack-message tags when isFollowUp is true", () => {
    const result = buildPrompt("new message", false, undefined, true);
    assert.ok(result.includes("<slack-message>\nnew message\n</slack-message>"));
    assert.ok(!result.includes("<slack-thread>"));
  });

  it("uses slack-thread tags when isFollowUp is false", () => {
    const result = buildPrompt("thread content", false, undefined, false);
    assert.ok(result.includes("<slack-thread>"));
    assert.ok(!result.includes("<slack-message>"));
  });

  it("includes triggeredBy in follow-up prompt", () => {
    const result = buildPrompt("msg", false, "Alice", true);
    assert.ok(result.includes("Triggered by: Alice"));
    assert.ok(result.includes("<slack-message>"));
  });
});

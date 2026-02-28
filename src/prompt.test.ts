import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "./prompt.js";

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
});

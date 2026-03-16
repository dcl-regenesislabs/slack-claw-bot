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

  it("appends attached files section when files are provided", () => {
    const files = [
      { name: "data.csv", mimetype: "text/csv", url: "https://files.slack.com/data.csv" },
      { name: "image.png", mimetype: "image/png", url: "https://files.slack.com/image.png" },
    ];
    const result = buildPrompt("hello", false, undefined, false, files);
    assert.ok(result.includes("## Attached Files"));
    assert.ok(result.includes("**data.csv** (text/csv)"));
    assert.ok(result.includes("**image.png** (image/png)"));
    assert.ok(result.includes("$SLACK_BOT_TOKEN"));
    assert.ok(result.includes("https://files.slack.com/data.csv"));
  });

  it("includes files in follow-up prompts", () => {
    const files = [{ name: "report.pdf", mimetype: "application/pdf", url: "https://files.slack.com/report.pdf" }];
    const result = buildPrompt("check this", false, undefined, true, files);
    assert.ok(result.includes("<slack-message>"));
    assert.ok(result.includes("## Attached Files"));
    assert.ok(result.includes("**report.pdf**"));
  });

  it("omits files section when files array is empty", () => {
    const result = buildPrompt("hello", false, undefined, false, []);
    assert.ok(!result.includes("## Attached Files"));
  });

  it("omits files section when files is undefined", () => {
    const result = buildPrompt("hello", false, undefined, false, undefined);
    assert.ok(!result.includes("## Attached Files"));
  });
});

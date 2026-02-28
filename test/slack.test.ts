import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToMrkdwn } from "../src/slack.js";

describe("markdownToMrkdwn", () => {
  it("converts bold markdown to mrkdwn", () => {
    assert.equal(markdownToMrkdwn("**bold**"), "*bold*");
  });

  it("converts markdown links to mrkdwn links", () => {
    assert.equal(
      markdownToMrkdwn("[click](https://example.com)"),
      "<https://example.com|click>",
    );
  });

  it("handles multiple conversions in one string", () => {
    const input = "**hello** and [link](https://x.com)";
    assert.equal(markdownToMrkdwn(input), "*hello* and <https://x.com|link>");
  });

  it("returns plain text unchanged", () => {
    assert.equal(markdownToMrkdwn("just text"), "just text");
  });

  it("returns empty string unchanged", () => {
    assert.equal(markdownToMrkdwn(""), "");
  });

  it("leaves single asterisks untouched", () => {
    assert.equal(markdownToMrkdwn("a * b * c"), "a * b * c");
  });
});

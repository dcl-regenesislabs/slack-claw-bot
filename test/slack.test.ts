import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToMrkdwn, isDeniedUser } from "../src/slack.js";

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

describe("isDeniedUser", () => {
  const HOME = "T_HOME";
  const DCL = "T_DCL";
  const allowed = new Set([DCL]);
  const none = new Set<string>();

  it("allows a full member of the home team", () => {
    assert.equal(isDeniedUser({ team_id: HOME }, HOME, none), false);
  });

  it("denies a user from another team when no allowlist is set", () => {
    assert.equal(isDeniedUser({ team_id: DCL, is_stranger: true }, HOME, none), true);
  });

  it("allows a user from an allowlisted external team", () => {
    assert.equal(isDeniedUser({ team_id: DCL, is_stranger: true }, HOME, allowed), false);
  });

  it("denies a user from a non-allowlisted external team", () => {
    assert.equal(isDeniedUser({ team_id: "T_OTHER", is_stranger: true }, HOME, allowed), true);
  });

  it("denies guests even on an allowlisted team", () => {
    assert.equal(isDeniedUser({ team_id: DCL, is_restricted: true }, HOME, allowed), true);
    assert.equal(isDeniedUser({ team_id: DCL, is_ultra_restricted: true }, HOME, allowed), true);
  });

  it("denies guests on the home team", () => {
    assert.equal(isDeniedUser({ team_id: HOME, is_restricted: true }, HOME, allowed), true);
  });

  it("denies a stranger with no team_id", () => {
    assert.equal(isDeniedUser({ is_stranger: true }, HOME, allowed), true);
  });

  it("allows a home-team member when home team is unresolved", () => {
    assert.equal(isDeniedUser({ team_id: HOME }, null, none), false);
  });
});

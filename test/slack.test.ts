import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToMrkdwn, isDeniedUser, pickImageUrl, sniffImageMime } from "../src/slack.js";

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

describe("pickImageUrl", () => {
  const base = {
    url_private_download: "https://files.slack.com/orig.png",
    thumb_1024: "https://files.slack.com/thumb_1024.png",
  };

  it("uses the original when it fits the vision limits", () => {
    assert.equal(pickImageUrl({ ...base, original_w: 3000, original_h: 2000, size: 1_000_000 }), base.url_private_download);
  });

  it("falls back to the 1024px thumbnail when a dimension exceeds 8000px", () => {
    assert.equal(pickImageUrl({ ...base, original_w: 12000, original_h: 500 }), base.thumb_1024);
    assert.equal(pickImageUrl({ ...base, original_w: "500", original_h: "8001" }), base.thumb_1024);
  });

  it("falls back to the thumbnail when the file is over 5MB", () => {
    assert.equal(pickImageUrl({ ...base, size: 6 * 1024 * 1024 }), base.thumb_1024);
  });

  it("returns undefined for an oversized image with no thumbnail", () => {
    assert.equal(pickImageUrl({ url_private_download: base.url_private_download, original_w: 9000 }), undefined);
  });
});

describe("sniffImageMime", () => {
  it("detects png, jpeg, gif and webp from magic bytes", () => {
    assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "image/png");
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
    assert.equal(sniffImageMime(Buffer.from("GIF89a\0\0", "latin1")), "image/gif");
    assert.equal(sniffImageMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "image/webp");
  });

  it("returns undefined for anything else", () => {
    assert.equal(sniffImageMime(Buffer.from("<html>")), undefined);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractEventText, extractBlockText } from "../src/slack-utils.js";

describe("extractEventText", () => {
  it("returns plain text messages unchanged", () => {
    assert.equal(extractEventText({ text: "hello" }), "hello");
  });

  it("extracts attachment text from bot messages with empty text", () => {
    const event = {
      text: "",
      attachments: [{ pretext: "New PR opened", text: "Fix login bug", fallback: "PR #42" }],
    };
    const out = extractEventText(event);
    assert.ok(out.includes("New PR opened"));
    assert.ok(out.includes("Fix login bug"));
  });

  it("merges text with attachments", () => {
    const out = extractEventText({
      text: "heads up",
      attachments: [{ text: "build failed" }],
    });
    assert.ok(out.includes("heads up"));
    assert.ok(out.includes("build failed"));
  });

  it("extracts section and header block text", () => {
    const out = extractEventText({
      blocks: [
        { type: "header", text: { type: "plain_text", text: "Deploy status" } },
        { type: "section", text: { type: "mrkdwn", text: "All green" } },
      ],
    });
    assert.ok(out.includes("Deploy status"));
    assert.ok(out.includes("All green"));
  });

  it("extracts nested rich_text elements including links", () => {
    const out = extractEventText({
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "see " },
                { type: "link", url: "https://example.com/pr/1" },
              ],
            },
          ],
        },
      ],
    });
    assert.ok(out.includes("see"));
    assert.ok(out.includes("https://example.com/pr/1"));
  });

  it("returns empty string when nothing is extractable", () => {
    assert.equal(extractEventText({}), "");
  });
});

describe("extractBlockText", () => {
  it("extracts fields from section blocks", () => {
    const out = extractBlockText([
      { type: "section", fields: [{ type: "mrkdwn", text: "*Status:* done" }, "raw string"] },
    ]);
    assert.ok(out.includes("*Status:* done"));
    assert.ok(out.includes("raw string"));
  });
});

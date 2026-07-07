import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateVotes,
  deterministicOutcome,
  parseVerdict,
  winningChoice,
  INVALID_POLL_OPTION,
} from "../src/poll-outcome.js";
import type { VotesByAddress } from "../src/governance.js";

// choices as stored by governance: user options + trailing invalid sentinel.
const YES_NO = ["Yes", "No", "Invalid question/options"];
const CUSTOM = ["Yes, set it to 5%", "Yes, set it to 10%", "Do not approve", "Invalid question/options"];
const AMBIGUOUS = ["Set the fee to 5%", "Set the fee to 10%", "Invalid question/options"];

function votes(entries: Array<[string, number, number]>): VotesByAddress {
  const out: VotesByAddress = {};
  for (const [addr, choice, vp] of entries) out[addr] = { choice, vp };
  return out;
}

describe("aggregateVotes", () => {
  it("sums voting power per choice using 1-based indices", () => {
    const tallies = aggregateVotes(YES_NO, votes([
      ["0xa", 1, 100],
      ["0xb", 1, 50],
      ["0xc", 2, 30],
    ]));
    assert.deepEqual(tallies.map((t) => t.power), [150, 30, 0]);
    assert.deepEqual(tallies.map((t) => t.votes), [2, 1, 0]);
  });

  it("ignores out-of-range and non-finite choices", () => {
    const tallies = aggregateVotes(YES_NO, votes([
      ["0xa", 0, 100], // 0 is out of range (1-based)
      ["0xb", 9, 100], // beyond choices
      ["0xc", 2, 40],
    ]));
    assert.deepEqual(tallies.map((t) => t.power), [0, 40, 0]);
  });
});

describe("winningChoice", () => {
  it("returns the max-power choice", () => {
    const tallies = aggregateVotes(CUSTOM, votes([
      ["0xa", 1, 10],
      ["0xb", 2, 90],
      ["0xc", 3, 5],
    ]));
    assert.equal(winningChoice(tallies)?.choice, "Yes, set it to 10%");
  });

  it("returns null when there are no votes", () => {
    const tallies = aggregateVotes(CUSTOM, {});
    assert.equal(winningChoice(tallies), null);
  });
});

describe("deterministicOutcome", () => {
  it("passes when a 'Yes, …' variant wins", () => {
    const tallies = aggregateVotes(CUSTOM, votes([["0xa", 1, 100], ["0xb", 3, 10]]));
    assert.equal(deterministicOutcome(CUSTOM, tallies)?.outcome, "passed");
  });

  it("rejects when a 'Do not …' option wins", () => {
    const tallies = aggregateVotes(CUSTOM, votes([["0xa", 3, 100], ["0xb", 1, 10]]));
    assert.equal(deterministicOutcome(CUSTOM, tallies)?.outcome, "rejected");
  });

  it("handles the default yes/no shape", () => {
    const yes = aggregateVotes(YES_NO, votes([["0xa", 1, 100]]));
    assert.equal(deterministicOutcome(YES_NO, yes)?.outcome, "passed");
    const no = aggregateVotes(YES_NO, votes([["0xa", 2, 100]]));
    assert.equal(deterministicOutcome(YES_NO, no)?.outcome, "rejected");
  });

  it("rejects when the invalid sentinel wins", () => {
    const tallies = aggregateVotes(YES_NO, votes([["0xa", 3, 100]]));
    const res = deterministicOutcome(YES_NO, tallies);
    assert.equal(res?.outcome, "rejected");
    assert.ok(INVALID_POLL_OPTION.length > 0);
  });

  it("returns null (defer to LLM) when the winner is neither approve- nor reject-shaped", () => {
    const tallies = aggregateVotes(AMBIGUOUS, votes([["0xa", 1, 100], ["0xb", 2, 10]]));
    assert.equal(deterministicOutcome(AMBIGUOUS, tallies), null);
  });

  it("returns null when there are no votes at all", () => {
    assert.equal(deterministicOutcome(CUSTOM, aggregateVotes(CUSTOM, {})), null);
  });
});

describe("parseVerdict", () => {
  it("parses a bare JSON object", () => {
    const v = parseVerdict('{"outcome":"passed","confidence":0.9,"rationale":"clear approval"}');
    assert.deepEqual(v, { outcome: "passed", confidence: 0.9, rationale: "clear approval" });
  });

  it("parses JSON embedded in prose and fences", () => {
    const text = 'Here is my call:\n```json\n{"outcome": "rejected", "confidence": 0.7, "rationale": "status quo won"}\n```\nThanks.';
    assert.deepEqual(parseVerdict(text), { outcome: "rejected", confidence: 0.7, rationale: "status quo won" });
  });

  it("prefers the last valid object when several appear", () => {
    const text = '{"outcome":"passed","confidence":0.4,"rationale":"first"} then {"outcome":"rejected","confidence":0.8,"rationale":"final"}';
    assert.equal(parseVerdict(text)?.rationale, "final");
  });

  it("clamps confidence into [0,1]", () => {
    assert.equal(parseVerdict('{"outcome":"passed","confidence":1.5,"rationale":"x"}')?.confidence, 1);
    assert.equal(parseVerdict('{"outcome":"passed","confidence":-3,"rationale":"x"}')?.confidence, 0);
  });

  it("defaults confidence to 0 when missing or non-numeric", () => {
    assert.equal(parseVerdict('{"outcome":"passed","rationale":"x"}')?.confidence, 0);
  });

  it("returns null for an invalid or absent outcome", () => {
    assert.equal(parseVerdict('{"outcome":"maybe","confidence":0.9}'), null);
    assert.equal(parseVerdict("no json here"), null);
    assert.equal(parseVerdict("{ not json }"), null);
  });

  it("is not fooled by braces inside strings", () => {
    const v = parseVerdict('{"outcome":"rejected","confidence":0.9,"rationale":"they said {no}"}');
    assert.equal(v?.rationale, "they said {no}");
  });
});

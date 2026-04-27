import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, formatCsvAsProposal } from "../src/csv.js";

test("parseCsv: single row", () => {
  const input = "Name,Age,City\nAlice,30,Austin";
  const result = parseCsv(input);
  assert.deepEqual(result.headers, ["Name", "Age", "City"]);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], { Name: "Alice", Age: "30", City: "Austin" });
});

test("parseCsv: multiple rows", () => {
  const input = "A,B\n1,2\n3,4\n5,6";
  const result = parseCsv(input);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[2], { A: "5", B: "6" });
});

test("parseCsv: quoted field containing comma", () => {
  const input = 'Name,Description\n"Smith, Jr.","Hello, world"';
  const result = parseCsv(input);
  assert.deepEqual(result.rows[0], { Name: "Smith, Jr.", Description: "Hello, world" });
});

test("parseCsv: quoted field containing newline", () => {
  const input = 'Name,Bio\n"Alice","Line 1\nLine 2"';
  const result = parseCsv(input);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].Bio, "Line 1\nLine 2");
});

test("parseCsv: escaped double-quote inside quoted field", () => {
  const input = 'Quote\n"She said ""hi"""';
  const result = parseCsv(input);
  assert.equal(result.rows[0].Quote, 'She said "hi"');
});

test("parseCsv: strips BOM", () => {
  const input = "\uFEFFA,B\n1,2";
  const result = parseCsv(input);
  assert.deepEqual(result.headers, ["A", "B"]);
});

test("parseCsv: CRLF line endings", () => {
  const input = "A,B\r\n1,2\r\n3,4";
  const result = parseCsv(input);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[1], { A: "3", B: "4" });
});

test("parseCsv: skips empty rows", () => {
  const input = "A,B\n1,2\n,\n3,4";
  const result = parseCsv(input);
  assert.equal(result.rows.length, 2);
});

test("parseCsv: header-only returns no rows", () => {
  const input = "A,B,C";
  const result = parseCsv(input);
  assert.deepEqual(result.headers, ["A", "B", "C"]);
  assert.equal(result.rows.length, 0);
});

test("parseCsv: completely empty input", () => {
  const result = parseCsv("");
  assert.equal(result.headers.length, 0);
  assert.equal(result.rows.length, 0);
});

test("parseCsv: unterminated quote throws", () => {
  assert.throws(
    () => parseCsv('Name\n"Alice'),
    /Unterminated quoted field/,
  );
});

test("parseCsv: unterminated quote mid-row throws", () => {
  assert.throws(
    () => parseCsv('A,B\n1,"unclosed'),
    /Unterminated quoted field/,
  );
});

test("parseCsv: semicolon delimiter (EU locale export)", () => {
  const input = "Name;Age;City\nAlice;30;Austin\nBob;25;Paris";
  const result = parseCsv(input);
  assert.deepEqual(result.headers, ["Name", "Age", "City"]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], { Name: "Alice", Age: "30", City: "Austin" });
  assert.deepEqual(result.rows[1], { Name: "Bob", Age: "25", City: "Paris" });
});

test("parseCsv: semicolon delimiter with quoted comma in value", () => {
  // A comma inside a quoted field must NOT trigger comma-delimiter detection
  // when semicolons dominate the unquoted header.
  const input = 'A;B;C\nx;"hello, world";z';
  const result = parseCsv(input);
  assert.deepEqual(result.rows[0], { A: "x", B: "hello, world", C: "z" });
});

test("parseCsv: wide row with many columns", () => {
  const headers = Array.from({ length: 52 }, (_, i) => `Col${i + 1}`);
  const values = Array.from({ length: 52 }, (_, i) => `val${i + 1}`);
  const input = headers.join(",") + "\n" + values.join(",");
  const result = parseCsv(input);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].Col52, "val52");
});

test("formatCsvAsProposal: asserts count in header", () => {
  const parsed = parseCsv("Title,Budget\nMy Project,50000");
  const output = formatCsvAsProposal(parsed, "proposal.csv");
  assert.match(output, /exactly 1 proposal/);
  assert.match(output, /Do not infer, generate, or hallucinate/);
  assert.match(output, /Proposal 1 of 1/);
  assert.match(output, /\*\*Title\*\*: My Project/);
  assert.match(output, /\*\*Budget\*\*: 50000/);
});

test("formatCsvAsProposal: omits empty fields", () => {
  const parsed = parseCsv("A,B,C\nx,,z");
  const output = formatCsvAsProposal(parsed, "x.csv");
  assert.match(output, /\*\*A\*\*: x/);
  assert.doesNotMatch(output, /\*\*B\*\*/);
  assert.match(output, /\*\*C\*\*: z/);
});

test("formatCsvAsProposal: no data rows message", () => {
  const parsed = parseCsv("A,B,C");
  const output = formatCsvAsProposal(parsed, "empty.csv");
  assert.match(output, /no data rows/);
});

test("formatCsvAsProposal: multi-row count", () => {
  const parsed = parseCsv("A\n1\n2\n3");
  const output = formatCsvAsProposal(parsed, "multi.csv");
  assert.match(output, /exactly 3 proposals/);
  assert.match(output, /Proposal 1 of 3/);
  assert.match(output, /Proposal 3 of 3/);
});

test("parseCsv: disambiguates duplicate headers with (N) suffix", () => {
  const parsed = parseCsv("Project title,Budget,Project title\nAlpha,100,Beta");
  assert.deepEqual(parsed.headers, ["Project title", "Budget", "Project title (2)"]);
  assert.equal(parsed.rows[0]["Project title"], "Alpha");
  assert.equal(parsed.rows[0]["Project title (2)"], "Beta");
});

test("parseCsv: normalizes pandas-style .N suffix to canonical (N) form", () => {
  // Some exporters (pandas, Excel) pre-disambiguate duplicates as "Foo.1".
  // Normalize to the canonical "(2)" form so downstream lookups stay stable.
  const parsed = parseCsv("Project title,Budget,Project title.1\nAlpha,100,Beta");
  assert.deepEqual(parsed.headers, ["Project title", "Budget", "Project title (2)"]);
  assert.equal(parsed.rows[0]["Project title (2)"], "Beta");
});

test("parseCsv: .1/.2 suffixes collapse and re-emit as (2)/(3)", () => {
  const parsed = parseCsv("Q,Q.1,Q.2\na,b,c");
  assert.deepEqual(parsed.headers, ["Q", "Q (2)", "Q (3)"]);
  assert.equal(parsed.rows[0]["Q"], "a");
  assert.equal(parsed.rows[0]["Q (2)"], "b");
  assert.equal(parsed.rows[0]["Q (3)"], "c");
});

test("formatCsvAsProposal: strips (N) suffix from display labels", () => {
  const parsed = parseCsv("Project title,Project title\nAlpha,Beta");
  const output = formatCsvAsProposal(parsed, "x.csv");
  // Both values shown, but labels are both "Project title" (no "(2)")
  assert.match(output, /\*\*Project title\*\*: Alpha/);
  assert.match(output, /\*\*Project title\*\*: Beta/);
  assert.doesNotMatch(output, /Project title \(2\)/);
});

test("formatCsvAsProposal: drops bureaucracy fields (email + acknowledgments)", () => {
  const parsed = parseCsv(
    "Email address,Project title,I confirm that the information submitted here is accurate to the best of my knowledge\nuser@x.com,MyProject,I confirm",
  );
  const output = formatCsvAsProposal(parsed, "x.csv");
  assert.doesNotMatch(output, /user@x\.com/);
  assert.doesNotMatch(output, /I confirm/);
  assert.match(output, /MyProject/);
});

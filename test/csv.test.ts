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

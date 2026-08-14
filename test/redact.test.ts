import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { redactSecrets, resetSecretCache } from "../src/sanitize.js";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  resetSecretCache();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetSecretCache();
});

test("redacts the exact value of a secret-named env var", () => {
  process.env.POSTHOG_API_KEY = "phx_notarealkeyvalue1234567890";
  resetSecretCache();
  // The leak that prompted this: an agent running `env | grep -i posthog`.
  const out = redactSecrets("POSTHOG_HOST=https://eu.posthog.com\nPOSTHOG_API_KEY=phx_notarealkeyvalue1234567890");
  assert.ok(!out.includes("phx_notarealkeyvalue1234567890"));
  assert.ok(out.includes("[REDACTED]"));
  assert.ok(out.includes("https://eu.posthog.com"), "non-secret config should survive");
});

test("redacts known token shapes even when not in the environment", () => {
  const cases = [
    "phx_abcdefghijklmnopqrstuvwxyz",
    "phc_abcdefghijklmnopqrstuvwxyz",
    "sk-ant-oat01-abcdefghijklmnopqrst",
    "xoxb-1234567890-abcdefghij",
    "xapp-1-A0123456789-abcdefghij",
    "ghp_abcdefghijklmnopqrstuvwxyz012345",
    "github_pat_abcdefghijklmnopqrstuvwxyz",
  ];
  for (const secret of cases) {
    const out = redactSecrets(`value is ${secret} here`);
    assert.ok(!out.includes(secret), `leaked ${secret}`);
    assert.ok(out.includes("[REDACTED]"));
  }
});

test("redacts a Bearer header", () => {
  const out = redactSecrets('curl -H "Authorization: Bearer phx_abcdefghijklmnopqrstuv"');
  assert.ok(!out.includes("phx_abcdefghijklmnopqrstuv"));
});

test("leaves ordinary text alone", () => {
  const text = "rows_returned: 4\nid=237538 | name=towerOfMadness";
  assert.equal(redactSecrets(text), text);
});

test("ignores short or empty secret-named vars", () => {
  process.env.SOME_TOKEN = "abc";
  resetSecretCache();
  assert.equal(redactSecrets("abc def"), "abc def");
});

test("redacts the longest matching secret when one contains another", () => {
  process.env.A_TOKEN = "supersecretvalue";
  process.env.B_TOKEN = "supersecretvalue-extended-tail";
  resetSecretCache();
  const out = redactSecrets("here: supersecretvalue-extended-tail");
  assert.ok(!out.includes("supersecretvalue"));
  assert.equal(out, "here: [REDACTED]");
});

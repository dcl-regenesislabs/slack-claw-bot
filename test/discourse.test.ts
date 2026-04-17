import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DiscourseClient, DiscourseError } from "../src/discourse.js";

type FetchArgs = { url: string; init: RequestInit | undefined };

let fetchCalls: FetchArgs[] = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () => {
  throw new Error("test did not set fetchImpl");
};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = async () => {
    throw new Error("test did not set fetchImpl");
  };
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createTopic: sends expected payload and returns topic URL", async () => {
  fetchImpl = async () =>
    new Response(
      JSON.stringify({ id: 100, topic_id: 42, topic_slug: "my-topic", post_number: 1 }),
      { status: 200 },
    );
  const client = new DiscourseClient("https://forum.example.org", "sekret");
  const result = await client.createTopic({
    title: "Hello",
    body: "Body text",
    categoryId: 7,
    username: "grants-bot",
  });
  assert.equal(result.topicId, 42);
  assert.equal(result.topicUrl, "https://forum.example.org/t/my-topic/42");
  assert.equal(fetchCalls.length, 1);
  const { url, init } = fetchCalls[0];
  assert.equal(url, "https://forum.example.org/posts.json");
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers["Api-Username"], "grants-bot");
  assert.equal(headers["Api-Key"], "sekret");
  assert.equal(headers["Content-Type"], "application/json");
  const body = JSON.parse(init?.body as string);
  assert.deepEqual(body, { title: "Hello", raw: "Body text", category: 7 });
});

test("reply: returns post URL", async () => {
  fetchImpl = async () =>
    new Response(
      JSON.stringify({ id: 555, topic_id: 42, topic_slug: "my-topic", post_number: 3 }),
      { status: 200 },
    );
  const client = new DiscourseClient("https://forum.example.org/", "k");
  const r = await client.reply({ topicId: 42, body: "reply", username: "voxel" });
  assert.equal(r.postId, 555);
  assert.equal(r.postUrl, "https://forum.example.org/t/my-topic/42/3");
});

test("baseUrl trailing slash is stripped", async () => {
  fetchImpl = async () => new Response("{}", { status: 200 });
  const client = new DiscourseClient("https://forum.example.org/", "k");
  await client.editPost({ postId: 1, body: "x", username: "u" }).catch(() => {});
  assert.equal(fetchCalls[0].url, "https://forum.example.org/posts/1.json");
});

test("failed request throws DiscourseError with status and safe message", async () => {
  fetchImpl = async () =>
    new Response("secret body with api key leaked", { status: 500, statusText: "Internal Server Error" });
  const client = new DiscourseClient("https://forum.example.org", "k");
  await assert.rejects(
    client.reply({ topicId: 1, body: "x", username: "voxel" }),
    (err: Error) => {
      assert.ok(err instanceof DiscourseError);
      assert.equal((err as DiscourseError).status, 500);
      // Body must NOT be in the user-facing error message
      assert.doesNotMatch(err.message, /secret body/);
      assert.match(err.message, /500/);
      return true;
    },
  );
});

test("404 on editPost throws DiscourseError with status 404", async () => {
  fetchImpl = async () => new Response("not found", { status: 404, statusText: "Not Found" });
  const client = new DiscourseClient("https://forum.example.org", "k");
  await assert.rejects(
    client.editPost({ postId: 99, body: "x", username: "oracle" }),
    (err: Error) => {
      assert.ok(err instanceof DiscourseError);
      assert.equal((err as DiscourseError).status, 404);
      return true;
    },
  );
});

test("410 Gone on editPost surfaces status 410", async () => {
  fetchImpl = async () => new Response("gone", { status: 410, statusText: "Gone" });
  const client = new DiscourseClient("https://forum.example.org", "k");
  await assert.rejects(
    client.editPost({ postId: 99, body: "x", username: "oracle" }),
    (err: Error) => {
      assert.ok(err instanceof DiscourseError);
      assert.equal((err as DiscourseError).status, 410);
      return true;
    },
  );
});

test("username containing newline is rejected (header injection guard)", async () => {
  fetchImpl = async () => new Response("{}", { status: 200 });
  const client = new DiscourseClient("https://forum.example.org", "k");
  await assert.rejects(
    client.reply({ topicId: 1, body: "x", username: "voxel\nX-Injected: evil" }),
    /Invalid Discourse username/,
  );
  assert.equal(fetchCalls.length, 0, "no HTTP request should be made");
});

test("username containing carriage return is rejected", async () => {
  fetchImpl = async () => new Response("{}", { status: 200 });
  const client = new DiscourseClient("https://forum.example.org", "k");
  await assert.rejects(
    client.createTopic({ title: "t", body: "b", categoryId: 1, username: "voxel\r\n" }),
    /Invalid Discourse username/,
  );
});

test("username containing colon is rejected", async () => {
  fetchImpl = async () => new Response("{}", { status: 200 });
  const client = new DiscourseClient("https://forum.example.org", "k");
  await assert.rejects(
    client.editPost({ postId: 1, body: "x", username: "voxel:admin" }),
    /Invalid Discourse username/,
  );
});

test("postUrl builds canonical short URL", () => {
  const client = new DiscourseClient("https://forum.example.org/", "k");
  assert.equal(client.postUrl(1234), "https://forum.example.org/p/1234");
});

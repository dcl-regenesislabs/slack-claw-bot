import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { Config } from "./config.js";
import { runAgent, syncAuth, REVIEW_MODEL, PR_URL_PATTERN, REVIEW_KEYWORD_PATTERN } from "./agent.js";
import { AgentScheduler } from "./concurrency.js";

const nameCache = new Map<string, string>();
const pendingResponses = new Map<string, string>();

const LARGE_RESPONSE_THRESHOLD = 3000;
const TEXT_MIMETYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);

let botToken: string;

const SCHEDULES_PATH =
  process.env.NODE_ENV === "production" && existsSync("/data")
    ? "/data/schedules.json"
    : "data/schedules.json";

function patchScheduleChannels(channelId: string): void {
  if (!existsSync(SCHEDULES_PATH)) return;
  try {
    const file = JSON.parse(readFileSync(SCHEDULES_PATH, "utf-8"));
    let changed = false;
    for (const s of file.schedules ?? []) {
      if (!s.channel) {
        s.channel = channelId;
        changed = true;
        console.log(`[slack] Patched schedule ${s.id} with channel ${channelId}`);
      }
    }
    if (changed) writeFileSync(SCHEDULES_PATH, JSON.stringify(file, null, 2), "utf-8");
  } catch (err) {
    console.error("[slack] Failed to patch schedule channels:", err);
  }
}

export async function startSlackBot(config: Config): Promise<void> {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  botToken = config.slackBotToken;
  const scheduler = new AgentScheduler(config.maxConcurrentAgents);

  app.action("deliver_file", async ({ action, body, ack, client }) => {
    await ack();
    const threadTs = (action as any).value;
    const channel = (body as any).channel.id;
    const pending = pendingResponses.get(threadTs);
    if (!pending) return;
    pendingResponses.delete(threadTs);
    await client.files.uploadV2({ channel_id: channel, thread_ts: threadTs, content: pending, filename: "response.md", title: "Response" });
    await client.chat.update({ channel, ts: (body as any).message.ts, text: "Delivered as a file.", blocks: [] });
  });

  app.action("deliver_message", async ({ action, body, ack, client }) => {
    await ack();
    const threadTs = (action as any).value;
    const channel = (body as any).channel.id;
    const pending = pendingResponses.get(threadTs);
    if (!pending) return;
    pendingResponses.delete(threadTs);
    await client.chat.postMessage({ channel, thread_ts: threadTs, text: markdownToMrkdwn(pending) });
    await client.chat.update({ channel, ts: (body as any).message.ts, text: "Delivered inline.", blocks: [] });
  });

  app.event("app_mention", async ({ event, client, say }) => {
    const threadTs = event.thread_ts || event.ts;
    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (event.user && await isExternalOrGuest(client, event.user)) {
      console.warn(`[slack] Denied request from non-org user ${event.user}`);
      return;
    }

    const [userName, channelName] = await Promise.all([
      event.user ? resolveUserName(client, event.user) : Promise.resolve("unknown"),
      resolveChannelName(client, event.channel),
    ]);
    const skill = detectSkill(text);
    console.log(`[slack] Triggered by ${userName} in #${channelName} [skill: ${skill}]: ${text}`);

    function react(name: string): Promise<unknown> {
      return client.reactions.add({ channel: event.channel, timestamp: event.ts, name })
        .catch((err) => { if (err.data?.error !== "already_reacted" && err.data?.error !== "message_not_found") throw err; });
    }
    function unreact(name: string): Promise<unknown> {
      return client.reactions.remove({ channel: event.channel, timestamp: event.ts, name })
        .catch((err) => { if (err.data?.error !== "no_reaction" && err.data?.error !== "message_not_found") throw err; });
    }

    const submission = scheduler.submit(threadTs, async () => {
      await react("hourglass_flowing_sand");

      let threadContent = await fetchThread(client, event.channel, threadTs);
      if (skill === "schedule") {
        threadContent = `[Schedule Context] channel: ${event.channel}\n\n${threadContent}`;
      }
      const isReview =
        PR_URL_PATTERN.test(threadContent) ||
        REVIEW_KEYWORD_PATTERN.test(text);
      const model = isReview ? REVIEW_MODEL : undefined;
      const { text: response, cost, tokens } = await runAgent({
        threadContent,
        triggeredBy: userName,
        model,
      });
      await syncAuth();
      if (skill === "schedule") {
        patchScheduleChannels(event.channel);
      }

      await unreact("hourglass_flowing_sand");
      if (response) {
        await react("white_check_mark");
        if (response.length > LARGE_RESPONSE_THRESHOLD) {
          pendingResponses.set(threadTs, response);
          const lines = response.split("\n").length;
          await say({
            thread_ts: threadTs,
            text: "This response is long — choose a format:",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: `This response is long (~${lines} lines). How would you like to receive it?` },
              },
              {
                type: "actions",
                elements: [
                  { type: "button", text: { type: "plain_text", text: "File (.md)" }, action_id: "deliver_file", value: threadTs },
                  { type: "button", text: { type: "plain_text", text: "Inline message" }, action_id: "deliver_message", value: threadTs },
                ],
              },
            ],
          } as any);
        } else {
          await say({ text: markdownToMrkdwn(response), thread_ts: threadTs });
        }
      } else {
        await react("warning");
        await say({ text: "I wasn't able to produce a response.", thread_ts: threadTs });
      }

      if (config.logChannelId) {
        postAuditLog(client, config.logChannelId, event, text, { status: "ok", cost, tokens })
          .catch((err) => console.error("[slack] Failed to post audit log:", err));
      }
    });

    if (submission === "thread-busy") {
      await say({ text: "I'm still working on your previous request in this thread.", thread_ts: threadTs });
      return;
    }

    if (submission.queued) {
      await say({ text: "I'm busy right now but your request is queued — I'll get to it shortly.", thread_ts: threadTs });
    }

    submission.done.catch(async (err) => {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      console.error("[slack] Agent error:", err);
      await unreact("hourglass_flowing_sand");
      await react("x");
      await say({ text: `Something went wrong: ${message}`, thread_ts: threadTs });

      if (config.logChannelId) {
        postAuditLog(client, config.logChannelId, event, text, { status: "error", error: message })
          .catch((e) => console.error("[slack] Failed to post audit log:", e));
      }
    });
  });

  app.error(async (error) => {
    console.error("[slack] Bolt error:", error);
  });

  await app.start();
  console.log("Slack bot is running");
}

async function cachedLookup(
  key: string,
  fetch: () => Promise<string>,
): Promise<string> {
  const cached = nameCache.get(key);
  if (cached) return cached;

  try {
    const name = await fetch();
    nameCache.set(key, name);
    return name;
  } catch {
    return key;
  }
}

interface AuthEntry {
  denied: boolean;
  cachedAt: number;
}

const authCache = new Map<string, AuthEntry>();
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function isExternalOrGuest(client: WebClient, userId: string): Promise<boolean> {
  const cached = authCache.get(userId);
  if (cached && Date.now() - cached.cachedAt <= AUTH_CACHE_TTL_MS) return cached.denied;

  try {
    const info = await client.users.info({ user: userId });
    const user = info.user as any;
    const denied = Boolean(user?.is_restricted || user?.is_ultra_restricted || user?.is_stranger);
    authCache.set(userId, { denied, cachedAt: Date.now() });

    // Cache the user name too, so resolveUserName won't re-fetch
    const name = info.user?.real_name || info.user?.name;
    if (name) nameCache.set(userId, name);

    return denied;
  } catch (err) {
    console.error(`[slack] Failed to check user ${userId}, denying by default:`, err);
    return true;
  }
}

function resolveUserName(client: WebClient, userId: string): Promise<string> {
  return cachedLookup(userId, async () => {
    const info = await client.users.info({ user: userId });
    return info.user?.real_name || info.user?.name || userId;
  });
}

function resolveChannelName(client: WebClient, channelId: string): Promise<string> {
  return cachedLookup(channelId, async () => {
    const info = await client.conversations.info({ channel: channelId });
    return info.channel?.name || channelId;
  });
}

type AuditOutcome =
  | { status: "ok"; cost: number; tokens: number }
  | { status: "error"; error: string };

async function postAuditLog(
  client: WebClient,
  logChannelId: string,
  event: { channel: string; ts: string; user?: string },
  text: string,
  outcome: AuditOutcome,
): Promise<void> {
  const { permalink } = await client.chat.getPermalink({
    channel: event.channel,
    message_ts: event.ts,
  });
  const detail = outcome.status === "ok"
    ? `$${outcome.cost.toFixed(4)} (${outcome.tokens} tokens)`
    : `error: ${outcome.error}`;
  const icon = outcome.status === "ok" ? "✅" : "❌";
  await client.chat.postMessage({
    channel: logChannelId,
    text: `${icon} <@${event.user}> in <#${event.channel}>: ${text} — ${detail}\n<${permalink}|View message>`,
  });
}

export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
}

async function fetchThread(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<string> {
  const reply = await client.conversations.replies({
    channel,
    ts: threadTs,
    limit: 200,
  });

  const messages = reply.messages || [];

  const uniqueUserIds = [...new Set(
    messages.map((m) => m.user).filter((id): id is string => Boolean(id)),
  )];
  const userNames = new Map<string, string>();
  await Promise.all(
    uniqueUserIds.map(async (uid) => {
      userNames.set(uid, await resolveUserName(client, uid));
    }),
  );

  const parts = await Promise.all(
    messages.map(async (m) => {
      const name = userNames.get(m.user || "") || "unknown";
      const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "";
      let content = `[${name}] (${ts}): ${m.text || ""}`;

      const files: any[] = (m as any).files || [];
      for (const file of files) {
        const ext = file.name?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
        if (TEXT_MIMETYPES.has(file.mimetype) || TEXT_EXTENSIONS.has(ext)) {
          const fileContent = await downloadTextFile(file.url_private_download);
          if (fileContent) {
            content += `\n[Attached file: ${file.name}]\n${fileContent}\n[/Attached file]`;
          }
        }
      }

      return content;
    }),
  );

  return parts.join("\n");
}

async function downloadTextFile(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok) return "";
    return res.text();
  } catch {
    return "";
  }
}

function detectSkill(text: string): string {
  const t = text.toLowerCase().trimStart();
  if (/^shape(\s+up)?[\s:]/.test(t)) return "shape";
  if (/\bpr[\s-]?review\b/.test(t) || (/\breview\b/.test(t) && /\bpr\b/.test(t))) return "pr-review";
  if (/\btriage\b/.test(t)) return "triage";
  if (/\bcreate\b.+\bissue\b/.test(t) || /\bopen\b.+\bissue\b/.test(t)) return "create-issue";
  if (/^fix\b/.test(t)) return "fix";
  if (/^s[ch]edule[\s:]/.test(t) || /\bschedul\w*\b/.test(t) || /\blist\s+schedules\b/.test(t)) return "schedule";
  if (/\bsentry\b/.test(t)) return "sentry";
  return "general";
}


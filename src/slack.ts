import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { Config } from "./config.js";
import { runAgent, syncAuth, REVIEW_MODEL, PR_URL_PATTERN, REVIEW_KEYWORD_PATTERN } from "./agent.js";
import { AgentScheduler } from "./concurrency.js";

export interface MediaAttachment {
  data: string;       // base64
  mimeType: string;
  filename: string;
}

export interface ThreadData {
  text: string;
  images: MediaAttachment[];
  videos: MediaAttachment[];
  files: MediaAttachment[];
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const TEXT_MIMES = new Set(["text/plain", "text/markdown"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES_PER_THREAD = 10;
const MAX_CACHE_ENTRIES = 100;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedAttachment {
  attachment: MediaAttachment;
  cachedAt: number;
}

const mediaCache = new Map<string, CachedAttachment>();

const nameCache = new Map<string, string>();

export async function startSlackBot(config: Config): Promise<void> {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  const scheduler = new AgentScheduler(config.maxConcurrentAgents);

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
    console.log(`[slack] Triggered by ${userName} in #${channelName}: ${text}`);

    function react(name: string): Promise<unknown> {
      return client.reactions.add({ channel: event.channel, timestamp: event.ts, name })
        .catch((err) => { if (err.data?.error !== "already_reacted") throw err; });
    }
    function unreact(name: string): Promise<unknown> {
      return client.reactions.remove({ channel: event.channel, timestamp: event.ts, name })
        .catch((err) => { if (err.data?.error !== "no_reaction") throw err; });
    }

    const submission = scheduler.submit(threadTs, async () => {
      await react("rl-bonk-doge");

      const threadData = await fetchThread(client, event.channel, threadTs, config.slackBotToken);
      const isReview =
        PR_URL_PATTERN.test(threadData.text) ||
        REVIEW_KEYWORD_PATTERN.test(text);
      const model = isReview ? REVIEW_MODEL : undefined;
      const { text: response, cost, tokens } = await runAgent({
        threadContent: threadData.text,
        images: threadData.images,
        videos: threadData.videos,
        files: threadData.files,
        triggeredBy: userName,
        model,
      });
      await syncAuth();

      await unreact("rl-bonk-doge");
      if (response) {
        await react("white_check_mark");
        await say({ text: markdownToMrkdwn(response), thread_ts: threadTs });
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
      await unreact("rl-bonk-doge");
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
  botToken: string,
): Promise<ThreadData> {
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

  const images: MediaAttachment[] = [];
  const videos: MediaAttachment[] = [];
  const files: MediaAttachment[] = [];
  let totalFiles = 0;

  // Evict expired cache entries, then cap size by removing oldest
  const now = Date.now();
  for (const [key, entry] of mediaCache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) mediaCache.delete(key);
  }
  while (mediaCache.size > MAX_CACHE_ENTRIES) {
    const oldest = mediaCache.keys().next().value!;
    mediaCache.delete(oldest);
  }

  const textLines: string[] = [];

  for (const m of messages) {
    const name = userNames.get(m.user || "") || "unknown";
    const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "";
    let line = `[${name}] (${ts}): ${m.text || ""}`;

    const msgFiles = (m as any).files as any[] | undefined;
    if (msgFiles) {
      for (const file of msgFiles) {
        const mime: string = file.mimetype || "";
        const filename: string = file.name || "unnamed";
        const fileId: string = file.id || "";
        const size: number = file.size || 0;
        const url: string = file.url_private_download || "";

        const isImage = IMAGE_MIMES.has(mime);
        const isVideo = VIDEO_MIMES.has(mime);
        const isText = TEXT_MIMES.has(mime);

        if (!isImage && !isVideo && !isText) {
          line += `\n[skipped file: ${filename} — unsupported type ${mime}]`;
          continue;
        }

        if (size > MAX_FILE_SIZE) {
          line += `\n[skipped file: ${filename} — exceeds 20MB limit]`;
          continue;
        }

        if (totalFiles >= MAX_FILES_PER_THREAD) {
          line += `\n[skipped file: ${filename} — thread file limit reached]`;
          continue;
        }

        if (!url) {
          line += `\n[skipped file: ${filename} — no download URL]`;
          continue;
        }

        let attachment: MediaAttachment;
        const cached = fileId ? mediaCache.get(fileId) : undefined;
        if (cached && now - cached.cachedAt <= CACHE_TTL_MS) {
          attachment = cached.attachment;
        } else {
          try {
            attachment = await downloadSlackFile(url, mime, filename, botToken);
            if (fileId) {
              mediaCache.set(fileId, { attachment, cachedAt: now });
            }
          } catch (err) {
            console.error(`[slack] Failed to download file ${filename}:`, err);
            line += `\n[skipped file: ${filename} — download failed]`;
            continue;
          }
        }

        totalFiles++;

        if (isImage) {
          images.push(attachment);
          line += `\n[attached image: ${filename}]`;
        } else if (isVideo) {
          videos.push(attachment);
          line += `\n[attached video: ${filename}]`;
        } else if (isText) {
          files.push(attachment);
          const content = Buffer.from(attachment.data, "base64").toString("utf-8");
          line += `\n[attached file: ${filename}]\n--- file content ---\n${content}\n--- end file ---`;
        }
      }
    }

    textLines.push(line);
  }

  return {
    text: textLines.join("\n"),
    images,
    videos,
    files,
  };
}

async function downloadSlackFile(
  url: string,
  mimeType: string,
  filename: string,
  botToken: string,
): Promise<MediaAttachment> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${filename}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    data: buffer.toString("base64"),
    mimeType,
    filename,
  };
}

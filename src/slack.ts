import { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { Config } from "./config.js";
import { runAgent, syncAuth } from "./agent.js";
import { AgentScheduler } from "./concurrency.js";

const nameCache = new Map<string, string>();

export async function startSlackBot(config: Config): Promise<void> {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });

  const scheduler = new AgentScheduler(config.maxConcurrentAgents, config.maxQueueSize);

  app.event("app_mention", async ({ event, client, say }) => {
    const threadTs = event.thread_ts || event.ts;
    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

    const [userName, channelName] = await Promise.all([
      event.user ? resolveUserName(client, event.user) : Promise.resolve("unknown"),
      resolveChannelName(client, event.channel),
    ]);
    console.log(`[slack] Triggered by ${userName} in #${channelName}: ${text}`);

    if (config.logChannelId) {
      postAuditLog(client, config.logChannelId, event, text)
        .catch((err) => console.error("[slack] Failed to post log message:", err));
    }

    function react(name: string): Promise<unknown> {
      return client.reactions.add({ channel: event.channel, timestamp: event.ts, name });
    }
    function unreact(name: string): Promise<unknown> {
      return client.reactions.remove({ channel: event.channel, timestamp: event.ts, name });
    }

    const result = scheduler.submit(threadTs, async () => {
      await react("rl-bonk-doge");

      const threadContent = await fetchThread(client, event.channel, threadTs);
      const response = await runAgent({ threadContent, sessionId: threadTs });
      await syncAuth();

      await unreact("rl-bonk-doge");
      if (response) {
        await react("white_check_mark");
        await say({ text: markdownToMrkdwn(response), thread_ts: threadTs });
      } else {
        await react("warning");
        await say({ text: "I wasn't able to produce a response.", thread_ts: threadTs });
      }
    });

    if (result === "thread-busy") {
      await say({ text: "I'm still working on your previous request in this thread.", thread_ts: threadTs });
      return;
    }

    if (result === "queue-full") {
      await say({ text: "I'm handling too many requests right now. Please try again in a moment.", thread_ts: threadTs });
      return;
    }

    result.done.catch(async (err) => {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      console.error("[slack] Agent error:", err);
      await unreact("rl-bonk-doge");
      await react("x");
      await say({ text: `Something went wrong: ${message}`, thread_ts: threadTs });
    });
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

async function postAuditLog(
  client: WebClient,
  logChannelId: string,
  event: { channel: string; ts: string; user?: string },
  text: string,
): Promise<void> {
  const { permalink } = await client.chat.getPermalink({
    channel: event.channel,
    message_ts: event.ts,
  });
  await client.chat.postMessage({
    channel: logChannelId,
    text: `*<@${event.user}>* in <#${event.channel}>: ${text}\n<${permalink}|View message>`,
  });
}

function markdownToMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
}

async function fetchThread(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<string> {
  const result = await client.conversations.replies({
    channel,
    ts: threadTs,
    limit: 200,
  });

  const messages = result.messages || [];

  const uniqueUserIds = [...new Set(
    messages.map((m) => m.user).filter((id): id is string => Boolean(id)),
  )];
  const userNames = new Map<string, string>();
  await Promise.all(
    uniqueUserIds.map(async (uid) => {
      userNames.set(uid, await resolveUserName(client, uid));
    }),
  );

  return messages
    .map((m) => {
      const name = userNames.get(m.user || "") || "unknown";
      const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "";
      return `[${name}] (${ts}): ${m.text || ""}`;
    })
    .join("\n");
}

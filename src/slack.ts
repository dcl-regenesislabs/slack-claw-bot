import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { Config } from "./config.js";
import { runAgent, syncAuth, detectReviewModel } from "./agent.js";
import type { FileAttachment } from "./prompt.js";
import { AgentScheduler } from "./concurrency.js";
import type { GrantsRouter } from "./grants.js";

const nameCache = new Map<string, string>();
let homeTeamId: string | null = null;

function isSlackError(err: unknown): err is { data?: { error?: string } } {
  return typeof err === "object" && err !== null && "data" in err;
}

interface SlackFile { name?: string; mimetype?: string; url_private_download?: string }
interface SlackMessage { text?: string; ts?: string; user?: string; files?: SlackFile[] }

export function createScheduler(maxConcurrent: number): AgentScheduler {
  return new AgentScheduler(maxConcurrent);
}

/**
 * Create and configure the Slack Bolt app. Does NOT start the socket listener.
 * Call {@link startSlackApp} after any additional setup (e.g. grants orchestrator).
 *
 * @param grantsRouterGetter - Optional lazy getter for the grants router. Called on every
 *   event to check if the router is available. This allows grants to be initialized after
 *   the app has been created, since initGrants() needs the App instance.
 */
export function createSlackApp(
  config: Config,
  scheduler: AgentScheduler,
  grantsRouterGetter?: () => GrantsRouter | null,
): App {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  app.event("app_mention", async ({ event, client, say }) => {
    const threadTs = event.thread_ts || event.ts;
    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (event.user && await isExternalOrGuest(client, event.user)) {
      console.warn(`[slack] Denied non-org user ${event.user}`);
      return;
    }

    // Route grants-channel mentions to the grants orchestrator if this thread belongs to it.
    const grantsRouter = grantsRouterGetter?.() ?? null;
    if (grantsRouter?.isGrantsThread(event.channel, threadTs)) {
      const userName = event.user ? await resolveUserName(client, event.user) : "unknown";
      const mentionFiles = extractAttachments((event as any).files);
      try {
        await grantsRouter.handleMention({
          text,
          threadTs,
          channelId: event.channel,
          eventTs: event.ts,
          userId: event.user || "unknown",
          username: userName,
          client,
          files: mentionFiles,
        });
      } catch (err) {
        console.error("[slack] Grants router failed:", err);
        await say({ text: `Grants handler error: ${(err as Error).message}`, thread_ts: threadTs });
      }
      return;
    }

    const files = extractAttachments((event as any).files);

    const userName = event.user ? await resolveUserName(client, event.user) : "unknown";
    const channelName = await resolveChannelName(client, event.channel);
    console.log(`[slack] ${userName} in #${channelName}: ${text}${files?.length ? ` (${files.length} file(s))` : ""}`);

    const submission = scheduler.submit(threadTs, async () => {
      await react(client, event.channel, event.ts, "rl-bonk-doge");

      const { text: response, cost, tokens, done } = await runAgent({
        threadTs,
        eventTs: event.ts,
        userId: event.user || "unknown",
        username: userName,
        newMessage: text,
        fetchThread: () => fetchThread(client, event.channel, threadTs),
        fetchThreadSince: (oldest) => fetchThreadSince(client, event.channel, threadTs, oldest),
        triggeredBy: userName,
        model: detectReviewModel(text),
        files,
      });

      // Reply to Slack immediately — memory save continues in background
      await syncAuth();
      await unreact(client, event.channel, event.ts, "rl-bonk-doge");

      if (response) {
        await react(client, event.channel, event.ts, "white_check_mark");
        await say({ text: markdownToMrkdwn(response), thread_ts: threadTs });
      } else {
        await react(client, event.channel, event.ts, "warning");
        await say({ text: "I wasn't able to produce a response.", thread_ts: threadTs });
      }

      if (config.logChannelId) {
        await postAuditLog(client, config.logChannelId, event, text, { status: "ok", cost, tokens });
      }

      // Wait for memory save before releasing the scheduler slot
      await done;
    });

    if (submission.status === "queued-behind-thread") {
      // No message — the reaction is enough
    } else if (submission.queued) {
      await say({ text: "I'm busy right now but your request is queued — I'll get to it shortly.", thread_ts: threadTs });
    }

    submission.done.catch(async (err) => {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      console.error("[slack] Agent error:", err);
      await unreact(client, event.channel, event.ts, "rl-bonk-doge");
      await react(client, event.channel, event.ts, "x");
      await say({ text: `Something went wrong: ${message}`, thread_ts: threadTs });

      if (config.logChannelId) {
        await postAuditLog(client, config.logChannelId, event, text, { status: "error", error: message });
      }
    });
  });

  app.error(async (error) => {
    console.error("[slack] Bolt error:", error);
  });

  return app;
}

/**
 * Start the Slack app's socket listener and resolve the home team ID.
 * Must be called after {@link createSlackApp} and any additional handler registration.
 */
export async function startSlackApp(app: App): Promise<void> {
  await app.start();

  // Resolve our workspace's team ID so we can reject Slack Connect users from other orgs
  try {
    const auth = await app.client.auth.test();
    homeTeamId = auth.team_id ?? null;
    console.log(`[slack] Home team: ${homeTeamId}`);
  } catch (err) {
    console.error("[slack] Failed to resolve home team ID:", err);
  }

  console.log("Slack bot is running");
}

/**
 * @deprecated Prefer {@link createSlackApp} + {@link startSlackApp}. Kept for backwards compatibility.
 */
export async function startSlackBot(config: Config, scheduler: AgentScheduler): Promise<App> {
  const app = createSlackApp(config, scheduler);
  await startSlackApp(app);
  return app;
}

// --- Reactions ---

export async function react(client: WebClient, channel: string, ts: string, name: string): Promise<void> {
  try {
    await client.reactions.add({ channel, timestamp: ts, name });
  } catch (err: unknown) {
    if (!isSlackError(err) || err.data?.error !== "already_reacted") throw err;
  }
}

export async function unreact(client: WebClient, channel: string, ts: string, name: string): Promise<void> {
  try {
    await client.reactions.remove({ channel, timestamp: ts, name });
  } catch (err: unknown) {
    if (!isSlackError(err) || err.data?.error !== "no_reaction") throw err;
  }
}

// --- Name Resolution ---

async function cachedLookup(key: string, fetcher: () => Promise<string>): Promise<string> {
  const cached = nameCache.get(key);
  if (cached) return cached;

  try {
    const name = await fetcher();
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
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;

async function isExternalOrGuest(client: WebClient, userId: string): Promise<boolean> {
  const cached = authCache.get(userId);
  if (cached && Date.now() - cached.cachedAt <= AUTH_CACHE_TTL_MS) return cached.denied;

  try {
    const info = await client.users.info({ user: userId });
    const user = info.user;
    const isGuest = Boolean(user?.is_restricted || user?.is_ultra_restricted || user?.is_stranger);
    const isExternalTeam = Boolean(homeTeamId && user?.team_id && user.team_id !== homeTeamId);
    const denied = isGuest || isExternalTeam;
    authCache.set(userId, { denied, cachedAt: Date.now() });

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

// --- Audit ---

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
  try {
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
  } catch (err) {
    console.error("[slack] Failed to post audit log:", err);
  }
}

// --- File Attachments ---

function extractAttachments(files?: SlackFile[]): FileAttachment[] | undefined {
  if (!files?.length) return undefined;
  const attachments = files
    .filter((f): f is SlackFile & { name: string; mimetype: string; url_private_download: string } =>
      Boolean(f.name && f.mimetype && f.url_private_download))
    .map((f) => ({ name: f.name, mimetype: f.mimetype, url: f.url_private_download }));
  return attachments.length ? attachments : undefined;
}

// --- Formatting ---

export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
}

// --- Thread Fetching ---

async function fetchThread(client: WebClient, channel: string, threadTs: string): Promise<string> {
  const reply = await client.conversations.replies({ channel, ts: threadTs, limit: 200 });
  return formatMessages(client, reply.messages || []);
}

async function fetchThreadSince(
  client: WebClient,
  channel: string,
  threadTs: string,
  sinceTs: string,
): Promise<string> {
  const reply = await client.conversations.replies({ channel, ts: threadTs, oldest: sinceTs, limit: 200 });
  const messages = (reply.messages || []).filter(
    (m) => m.ts && parseFloat(m.ts) > parseFloat(sinceTs),
  );
  return formatMessages(client, messages);
}

async function formatMessages(client: WebClient, messages: SlackMessage[]): Promise<string> {
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
      let line = `[${name}] (${ts}): ${m.text || ""}`;
      if (m.files?.length) {
        const fileList = m.files
          .filter((f) => f.name)
          .map((f) => `[attached: ${f.name}${f.mimetype ? ` (${f.mimetype})` : ""}]`)
          .join(" ");
        if (fileList) line += ` ${fileList}`;
      }
      return line;
    })
    .join("\n");
}

import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./paths.js";
import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { Config } from "./config.js";
import { runAgent, detectReviewModel, getMemoryDir } from "./agent.js";
import type { ThreadFetch } from "./agent.js";
import { schedulesFilePath } from "./schedule.js";
import type { FileAttachment } from "./prompt.js";
import { extractEventText, markdownToMrkdwn, sniffImageMime } from "./slack-utils.js";
import type { SlackBlock } from "./slack-utils.js";
import { AgentScheduler } from "./concurrency.js";
import { redactSecrets } from "./sanitize.js";
import type { GrantsRouter } from "./grants.js";

const nameCache = new Map<string, string>();
let homeTeamId: string | null = null;
let allowedTeamIds: ReadonlySet<string> = new Set();
let botToken: string | null = null;

function isSlackError(err: unknown): err is { data?: { error?: string } } {
  return typeof err === "object" && err !== null && "data" in err;
}

export interface SlackFile {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
  size?: number;
  // Slack's typings say string; the wire value is sometimes a number.
  original_w?: number | string;
  original_h?: number | string;
  /** Slack-rendered thumbnail, longest edge 1024px. */
  thumb_1024?: string;
}
interface SlackMessage {
  text?: string;
  ts?: string;
  user?: string;
  files?: SlackFile[];
  attachments?: Array<{ text?: string; fallback?: string; pretext?: string }>;
  blocks?: SlackBlock[];
  bot_profile?: { name?: string };
  username?: string;
}

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
  allowedTeamIds = new Set(config.allowedTeamIds);
  botToken = config.slackBotToken;
  pruneAttachments();

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

    const files = await downloadAttachments((event as any).files);

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
        channelName,
        channelId: event.channel,
        // Per-run capability: only interactive Slack runs may manage schedules.
        schedulesFile: getMemoryDir() ? schedulesFilePath(getMemoryDir()!) : undefined,
      });

      // Reply to Slack immediately — memory save continues in background
      await unreact(client, event.channel, event.ts, "rl-bonk-doge");

      if (response) {
        await react(client, event.channel, event.ts, "white_check_mark");
        await say({ text: redactSecrets(markdownToMrkdwn(response)), thread_ts: threadTs });
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

    submission.done.catch((err) => handleSubmissionError(err, {
      label: "Agent error",
      removeReaction: () => unreact(client, event.channel, event.ts, "rl-bonk-doge"),
      addReaction: () => react(client, event.channel, event.ts, "x"),
      say,
      threadTs,
      auditLog: config.logChannelId
        ? (message) => postAuditLog(client, config.logChannelId!, event, text, { status: "error", error: message })
        : undefined,
    }));
  });

  app.error(async (error) => {
    console.error("[slack] Bolt error:", error);
  });

  return app;
}

/**
 * Every Slack call in the error path is individually caught: one API failure (deleted
 * message, transient hiccup) must not suppress the user-facing error message or surface
 * as an unhandled rejection from the handler itself.
 */
export function handleSubmissionError(
  err: unknown,
  opts: {
    label: string;
    removeReaction: () => Promise<unknown>;
    addReaction: () => Promise<unknown>;
    say: (args: { text: string; thread_ts: string }) => Promise<unknown>;
    threadTs: string;
    auditLog?: (message: string) => Promise<unknown>;
  },
): void {
  const message = err instanceof Error ? err.message : "Unknown error occurred";
  console.error(`[slack] ${opts.label}:`, err);
  (async () => {
    await opts.removeReaction().catch((e) => console.error("[slack] removeReaction failed:", e));
    await opts.addReaction().catch((e) => console.error("[slack] addReaction failed:", e));
    await opts.say({ text: `Something went wrong: ${sanitizeForSlack(message)}`, thread_ts: opts.threadTs })
      .catch((e) => console.error("[slack] say failed:", e));
    if (opts.auditLog) {
      await opts.auditLog(message).catch((e) => console.error("[slack] Failed to post audit log:", e));
    }
  })().catch((e) => console.error("[slack] Error handler itself failed:", e));
}

const MAX_ERROR_LENGTH = 300;
const SLACK_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function sanitizeForSlack(text: string): string {
  const escaped = redactSecrets(text).replace(/[&<>]/g, (ch) => SLACK_ESCAPES[ch]);
  return escaped.length > MAX_ERROR_LENGTH ? escaped.slice(0, MAX_ERROR_LENGTH) + "…" : escaped;
}

/**
 * Start the Slack app's socket listener and resolve the home team ID.
 * Must be called after {@link createSlackApp} and any additional handler registration.
 */
export async function startSlackApp(app: App, opts?: { socketMaxSilenceMs?: number }): Promise<void> {
  // The socket client is the App's auto-created SocketModeReceiver's `client`; Bolt exposes
  // no public getter, so we reach it via the receiver. Attach BEFORE app.start() so the
  // initial `connected` event is captured. Verified with @slack/bolt 5.0.x — re-check this
  // reach-in after any @slack/bolt major bump.
  const socketClient = (app as unknown as { receiver?: { client?: SocketModeConnection } }).receiver?.client;
  if (socketClient) {
    startSlackSocketHealthCheck(socketClient, {
      maxSilenceMs: opts?.socketMaxSilenceMs ?? DEFAULT_SLACK_SOCKET_MAX_SILENCE_MS,
    });
  } else {
    console.warn("[slack] socket health — no Socket Mode client found; self-heal disabled");
  }

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

// --- Socket Mode health check + self-heal ---
//
// A silently-dead Socket Mode connection leaves the bot alive but deaf: the process (and any
// health endpoint) stays green while no events arrive, forever. The probe reads the socket
// connection state rather than making a Web API call — the Web API stays up during exactly
// this failure. On a sustained disconnect it self-heals by sending the process its own
// SIGTERM, reusing the graceful shutdown in index.ts; the supervisor restarts a fresh process.

const SLACK_SOCKET_HEALTH_INTERVAL_MS = 30_000;
const SLACK_SOCKET_OK_LOG_EVERY = 6; // ~every 3 min at a 30s interval

export const DEFAULT_SLACK_SOCKET_MAX_SILENCE_MS = 150_000;

type SocketHealthEvent = "connected" | "authenticated" | "reconnecting" | "disconnected";

/** Minimal view of the SocketModeClient — only the connection-state events we subscribe to. */
interface SocketModeConnection {
  on(event: SocketHealthEvent, listener: (...args: unknown[]) => void): unknown;
  off?(event: SocketHealthEvent, listener: (...args: unknown[]) => void): unknown;
}

export interface SocketHealthState {
  connected: boolean;
  lastConnectedAt: number;
}

export type SocketHealthAction =
  | { kind: "ok" }
  | { kind: "reconnecting"; silenceMs: number }
  | { kind: "trip"; silenceMs: number };

/**
 * Pure decision function: connected ⇒ ok; disconnected but still within the grace window ⇒
 * reconnecting; disconnected past maxSilenceMs ⇒ trip.
 */
export function evaluateSocketHealth(
  state: SocketHealthState,
  now: number,
  maxSilenceMs: number,
): SocketHealthAction {
  if (state.connected) return { kind: "ok" };
  const silenceMs = now - state.lastConnectedAt;
  if (silenceMs >= maxSilenceMs) return { kind: "trip", silenceMs };
  return { kind: "reconnecting", silenceMs };
}

export function startSlackSocketHealthCheck(
  client: SocketModeConnection,
  opts: {
    maxSilenceMs: number;
    /** Injected in tests. Default requests the process's own graceful SIGTERM shutdown. */
    onTrip?: (silenceMs: number) => void;
    /** Injected in tests. */
    now?: () => number;
  },
): { stop: () => void; getState: () => SocketHealthState } {
  const now = opts.now ?? (() => Date.now());
  const onTrip = opts.onTrip ?? (() => process.kill(process.pid, "SIGTERM"));
  // Start pessimistic: if `connected` never fires, silence accrues from t0 and trips.
  const state: SocketHealthState = { connected: false, lastConnectedAt: now() };
  let tripped = false;
  let okCount = 0;

  const markConnected = () => {
    state.connected = true;
    state.lastConnectedAt = now();
  };
  const markDown = () => {
    state.connected = false;
  };

  // One table so subscribe and unsubscribe can never drift apart.
  const listeners: Array<[SocketHealthEvent, () => void]> = [
    ["connected", markConnected],
    ["authenticated", markConnected],
    ["reconnecting", markDown],
    ["disconnected", markDown],
  ];
  for (const [event, listener] of listeners) client.on(event, listener);

  const timer = setInterval(() => {
    if (tripped) return;
    const action = evaluateSocketHealth(state, now(), opts.maxSilenceMs);
    if (action.kind === "ok") {
      if (++okCount >= SLACK_SOCKET_OK_LOG_EVERY) {
        console.log("[slack] socket health — connected");
        okCount = 0;
      }
    } else if (action.kind === "reconnecting") {
      okCount = 0;
      console.warn(`[slack] socket health — disconnected, reconnecting (${Math.round(action.silenceMs / 1000)}s)`);
    } else {
      okCount = 0;
      tripped = true;
      console.error(
        `[slack] socket health — DEAD: no Socket Mode connection for ${Math.round(action.silenceMs / 1000)}s ` +
        `(exceeds ${Math.round(opts.maxSilenceMs / 1000)}s limit) — triggering restart`,
      );
      onTrip(action.silenceMs);
    }
  }, SLACK_SOCKET_HEALTH_INTERVAL_MS);
  timer.unref();

  return {
    stop: () => {
      clearInterval(timer);
      for (const [event, listener] of listeners) client.off?.(event, listener);
    },
    getState: () => ({ ...state }),
  };
}

// --- Reactions ---

// Tolerated: reacting twice, removing a missing reaction, or a deleted message.
const REACT_TOLERATED = new Set(["already_reacted", "no_reaction", "message_not_found"]);

export async function react(client: WebClient, channel: string, ts: string, name: string): Promise<void> {
  try {
    await client.reactions.add({ channel, timestamp: ts, name });
  } catch (err: unknown) {
    if (!isSlackError(err) || !REACT_TOLERATED.has(err.data?.error ?? "")) throw err;
  }
}

export async function unreact(client: WebClient, channel: string, ts: string, name: string): Promise<void> {
  try {
    await client.reactions.remove({ channel, timestamp: ts, name });
  } catch (err: unknown) {
    if (!isSlackError(err) || !REACT_TOLERATED.has(err.data?.error ?? "")) throw err;
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

export interface SlackUserFlags {
  team_id?: string;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
}

/**
 * A user is denied unless they are a full member of the home workspace or of an
 * explicitly allowed external workspace (ALLOWED_TEAM_IDS, e.g. Decentraland's
 * Slack shared via Slack Connect). Guests are always denied.
 */
export function isDeniedUser(
  user: SlackUserFlags | undefined,
  homeTeam: string | null,
  allowedTeams: ReadonlySet<string>,
): boolean {
  const teamId = user?.team_id;
  if (user?.is_restricted || user?.is_ultra_restricted) return true;
  if (teamId && allowedTeams.has(teamId)) return false;
  // is_stranger flags Slack Connect users from other workspaces
  const isStranger = Boolean(user?.is_stranger);
  const isExternalTeam = Boolean(homeTeam && teamId && teamId !== homeTeam);
  return isStranger || isExternalTeam;
}

async function isExternalOrGuest(client: WebClient, userId: string): Promise<boolean> {
  const cached = authCache.get(userId);
  if (cached && Date.now() - cached.cachedAt <= AUTH_CACHE_TTL_MS) return cached.denied;

  try {
    const info = await client.users.info({ user: userId });
    const denied = isDeniedUser(info.user, homeTeamId, allowedTeamIds);
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
      text: redactSecrets(`${icon} <@${event.user}> in <#${event.channel}>: ${text} — ${detail}\n<${permalink}|View message>`),
    });
  } catch (err) {
    console.error("[slack] Failed to post audit log:", err);
  }
}

// --- File Attachments ---

type NamedSlackFile = SlackFile & { name: string; mimetype: string; url_private_download: string };

function namedFiles(files?: SlackFile[]): NamedSlackFile[] {
  return (files ?? []).filter((f): f is NamedSlackFile => Boolean(f.name && f.mimetype && f.url_private_download));
}

/** URL-only attachment list, for callers that fetch the bytes themselves (grants CSVs). */
function extractAttachments(files?: SlackFile[]): FileAttachment[] | undefined {
  const attachments = namedFiles(files).map((f) => ({ name: f.name, mimetype: f.mimetype, url: f.url_private_download }));
  return attachments.length ? attachments : undefined;
}

// Deterministic per-file-id paths: a follow-up run reuses what an earlier run fetched.
const attachmentsDir = () => stateDir("claw-attachments");
const ATTACHMENT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Drop attachments no run has touched in two weeks; on a persistent volume nothing else would. */
export function pruneAttachments(now = Date.now()): void {
  const dir = attachmentsDir();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > ATTACHMENT_MAX_AGE_MS) unlinkSync(path);
    } catch {
      // raced with a download or a concurrent prune — nothing to do
    }
  }
}
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const SLACK_FILE_ID = /^F[A-Z0-9]+$/;
// Slack private file URLs live on *.slack.com — the token is never sent anywhere else.
const SLACK_FILE_URL = /^https:\/\/[a-z0-9-]+\.slack\.com\//i;
const EXTENSION_BY_MIMETYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "application/pdf": "pdf",
};

/** Server-chosen file name: the Slack file id plus an extension from the mimetype — never the
 * user-controlled name. Mimetypes outside the table are not fetched at all. */
export function attachmentFilename(id: string | undefined, mimetype: string): string | undefined {
  const ext = EXTENSION_BY_MIMETYPE[mimetype];
  if (!id || !ext || !SLACK_FILE_ID.test(id)) return undefined;
  return `${id}.${ext}`;
}

// Sequential on purpose: a thread is fetched once per session and every later fetch hits the
// on-disk cache, so a burst of parallel 50MB downloads buys nothing but heap.
async function downloadAttachments(files?: SlackFile[]): Promise<FileAttachment[]> {
  const attachments: FileAttachment[] = [];
  for (const f of namedFiles(files)) {
    const attachment = { name: f.name, mimetype: f.mimetype, url: f.url_private_download };
    attachments.push(attachment);
    const filename = attachmentFilename(f.id, f.mimetype);
    if (!filename || (f.size ?? 0) > MAX_ATTACHMENT_BYTES) continue;
    const path = join(attachmentsDir(), filename);
    if (existsSync(path)) {
      attachments[attachments.length - 1] = { ...attachment, path };
      continue;
    }
    const bytes = await downloadSlackFile(f.url_private_download, MAX_ATTACHMENT_BYTES);
    if (!bytes) continue;
    try {
      // Temp + rename: a crash mid-write must not leave a truncated file existsSync will trust.
      const partial = `${path}.${process.pid}.${Date.now()}.part`;
      await writeFile(partial, bytes);
      await rename(partial, path);
      attachments[attachments.length - 1] = { ...attachment, path };
    } catch (err) {
      console.warn(`[slack] Could not store attachment ${filename}:`, (err as Error).message);
    }
  }
  return attachments;
}

/** Fetch a Slack-hosted file, giving up before `maxBytes` is exceeded (header first, then the stream). */
async function downloadSlackFile(url: string | undefined, maxBytes: number): Promise<Buffer | null> {
  if (!url || !botToken || !SLACK_FILE_URL.test(url)) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

// --- Formatting ---

export { markdownToMrkdwn, sniffImageMime } from "./slack-utils.js";

// --- Thread Fetching ---

const IMAGE_MIMETYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// Anthropic vision limits: the API rejects the whole request for a single oversized image.
const MAX_IMAGE_DIMENSION = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The original when it fits the vision limits, otherwise Slack's 1024px thumbnail. */
export function pickImageUrl(f: SlackFile): string | undefined {
  const tooLarge =
    Number(f.original_w ?? 0) > MAX_IMAGE_DIMENSION ||
    Number(f.original_h ?? 0) > MAX_IMAGE_DIMENSION ||
    (f.size ?? 0) > MAX_IMAGE_BYTES;
  return tooLarge ? f.thumb_1024 : f.url_private_download ?? f.url_private;
}

async function fetchThread(client: WebClient, channel: string, threadTs: string): Promise<ThreadFetch> {
  const reply = await client.conversations.replies({ channel, ts: threadTs, limit: 200 });
  return formatMessages(client, reply.messages || []);
}

async function fetchThreadSince(
  client: WebClient,
  channel: string,
  threadTs: string,
  sinceTs: string,
): Promise<ThreadFetch> {
  const reply = await client.conversations.replies({ channel, ts: threadTs, oldest: sinceTs, limit: 200 });
  const messages = (reply.messages || []).filter(
    (m) => m.ts && parseFloat(m.ts) > parseFloat(sinceTs),
  );
  return formatMessages(client, messages);
}

async function formatMessages(client: WebClient, messages: SlackMessage[]): Promise<ThreadFetch> {
  const uniqueUserIds = [...new Set(
    messages.map((m) => m.user).filter((id): id is string => Boolean(id)),
  )];
  const userNames = new Map<string, string>();
  await Promise.all(
    uniqueUserIds.map(async (uid) => {
      userNames.set(uid, await resolveUserName(client, uid));
    }),
  );

  const images: ImageContent[] = [];
  const files: FileAttachment[] = [];
  const lines: string[] = [];
  for (const m of messages) {
    const attachments = await downloadAttachments(m.files);
    files.push(...attachments);
    const name = userNames.get(m.user || "") || m.bot_profile?.name || m.username || "unknown";
    const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "";
    let line = `[${name}] (${ts}): ${extractEventText(m)}`;
    for (const f of m.files ?? []) {
      if (!f.name) continue;
      const local = attachments.find((a) => a.url === f.url_private_download)?.path;
      if (f.mimetype && IMAGE_MIMETYPES.has(f.mimetype)) {
        const image = await loadImage(f, local);
        if (image) {
          images.push({ type: "image", data: image.data, mimeType: image.mimeType ?? f.mimetype });
          line += ` [attached image: ${f.name}]`;
          continue;
        }
      }
      line += ` [attached: ${f.name}${f.mimetype ? ` (${f.mimetype})` : ""}${local ? "" : ", not available locally"}]`;
    }
    lines.push(line);
  }

  return { content: lines.join("\n"), images, files: files.length ? files : undefined };
}

/** Vision bytes: the local copy when it is the original we would fetch anyway, else Slack's thumbnail. */
async function loadImage(f: SlackFile, localPath?: string): Promise<{ data: string; mimeType?: string } | null> {
  const url = pickImageUrl(f);
  const buf = localPath && url === f.url_private_download
    ? await readFile(localPath).catch(() => null)
    : await downloadSlackFile(url, MAX_IMAGE_BYTES);
  if (!buf || buf.length > MAX_IMAGE_BYTES) return null;
  return { data: buf.toString("base64"), mimeType: sniffImageMime(buf) };
}

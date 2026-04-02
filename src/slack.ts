import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { Config } from "./config.js";
import { runAgent, syncAuth, getStatusMessage, REVIEW_MODEL, PR_URL_PATTERN, MR_URL_PATTERN, REVIEW_KEYWORD_PATTERN } from "./agent.js";
import { AgentScheduler, DmScheduler } from "./concurrency.js";
import { createSlackTools } from "./tools/read-slack-thread.js";
import { extractEventText } from "./slack-utils.js";
import {
  isPublicChannel,
  isNoLearning,
  getGlobalContext,
  saveGlobalContext,
  saveConversationSummary,
  truncateForInjection,
  buildSummaryPrompt,
  buildMemoryUpdatePrompt,
  buildCompressionPrompt,
  MAX_STORE_CHARS,
  type ConversationSummary,
} from "./memory.js";

export const SKILL_MODELS: Partial<Record<string, string>> = {
  'pr-review': 'claude-opus-4-6',
  'shape': 'claude-opus-4-6',
  'plan': 'claude-opus-4-6',
  'fix': 'claude-opus-4-6',
  'incident': 'claude-opus-4-6',
  'pipeline': 'claude-opus-4-6',
  'sentry': 'claude-opus-4-6',
  'release-review': 'claude-opus-4-6',
  'aws-infra': 'claude-opus-4-6'
}

const nameCache = new Map<string, string>();
const pendingResponses = new Map<string, string>();

const LARGE_RESPONSE_THRESHOLD = 3000;
const TEXT_MIMETYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const IMAGE_MIMETYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// Re-export so existing consumers (tests, etc.) aren't broken.
export { extractEventText } from "./slack-utils.js";

let botToken: string;

/** Determines whether the message handler should process an incoming event. */
export function shouldHandleMessage(
  event: { channel_type?: string; channel?: string; thread_ts?: string; bot_id?: string; bot_profile?: unknown; text?: string; subtype?: string; user?: string; attachments?: Array<{ text?: string; fallback?: string; pretext?: string }>; blocks?: Array<Record<string, any>> },
  autoReplyChannels?: Map<string, string>
): { handle: boolean; isAutoReply: boolean; skill?: string; reason?: string } {
  const isDm = event.channel_type === "im";
  const autoReplySkill = autoReplyChannels?.get(event.channel ?? "");
  const isAutoReply = !!autoReplySkill;
  if (!isDm && !isAutoReply) return { handle: false, isAutoReply: false, reason: "not a DM or auto-reply channel" };
  if (isAutoReply) {
    if (event.thread_ts) return { handle: false, isAutoReply: true, reason: "thread reply in auto-reply channel" };
  }
  if (event.subtype && !isAutoReply) return { handle: false, isAutoReply, reason: `subtype: ${event.subtype}` };
  if (!extractEventText(event)) return { handle: false, isAutoReply, reason: "no text content" };
  if (!event.user && !isAutoReply) return { handle: false, isAutoReply, reason: "no user" };
  return { handle: true, isAutoReply, skill: autoReplySkill };
}

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

function isChannelEligibleForMemory(channelId: string, config: Config): boolean {
  return Boolean(config.s3) && isPublicChannel(channelId)
}

function isMemoryReadable(config: Config): boolean {
  return Boolean(config.s3)
}

async function triggerMemoryUpdate(
  config: Config,
  channelId: string,
  threadTs: string,
  threadContent: string,
  agentResponse: string
): Promise<void> {
  try {
    const { text: summaryText } = await runAgent({
      threadContent: buildSummaryPrompt(threadContent, agentResponse),
      triggeredBy: 'memory-summarize',
      model: config.model,
    })

    if (!summaryText || isNoLearning(summaryText)) {
      console.log('[memory] Skipping update — interaction not worth learning from')
      return
    }

    const summary: ConversationSummary = {
      channelId,
      threadTs,
      savedAt: new Date().toISOString(),
      summary: summaryText,
    }

    await saveConversationSummary(config.s3!, summary)

    const currentContext = await getGlobalContext(config.s3!)
    const { text: updatedContext } = await runAgent({
      threadContent: buildMemoryUpdatePrompt(currentContext, summary),
      triggeredBy: 'memory-update',
      model: config.model,
    })

    if (updatedContext) {
      let contextToSave = updatedContext
      if (contextToSave.length > MAX_STORE_CHARS) {
        console.warn('[memory] Context too large, running compression pass')
        const { text: compressed } = await runAgent({
          threadContent: buildCompressionPrompt(contextToSave),
          triggeredBy: 'memory-compress',
          model: config.model,
        })
        if (compressed) contextToSave = compressed
      }
      await saveGlobalContext(config.s3!, contextToSave)
      console.log('[memory] Global context updated')
    }
  } catch (err) {
    console.error('[memory] Failed to update memory:', err)
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
  const dmScheduler = new DmScheduler();

  // When a queued request starts processing, notify the user
  scheduler.onDequeued = (threadId: string) => {
    const meta = queuedMessages.get(threadId);
    if (!meta) return;
    queuedMessages.delete(threadId);
    app.client.chat.update({
      channel: meta.channel,
      ts: meta.messageTs,
      text: ":hourglass_flowing_sand: Your request is now being processed!",
    }).catch((err) => console.error("[slack] Failed to update queued message:", err));
  };

  /** Track queued notification messages so we can update them when work starts */
  const queuedMessages = new Map<string, { channel: string; messageTs: string }>();

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
      await say({ text: "Sorry, I'm not available for external or guest users.", thread_ts: threadTs });
      return;
    }

    // "status" command — reply with cached rate limits, no agent needed
    if (/^\s*status\s*$/i.test(text)) {
      await say({ text: getStatusMessage(), thread_ts: threadTs });
      return;
    }

    const [userName, channelName] = await Promise.all([
      event.user ? resolveUserName(client, event.user) : Promise.resolve("unknown"),
      resolveChannelName(client, event.channel),
    ]);
    const skill = detectSkill(text);
    console.log(`[slack] Triggered by ${userName} (${event.user}) in #${channelName} [skill: ${skill}]: ${text}`);

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

      const fetchResult = await fetchThread(client, event.channel, threadTs);
      let threadContent = fetchResult.content;
      const threadImages = fetchResult.images;
      if (skill === "schedule") {
        threadContent = `[Schedule Context] channel: ${event.channel}\n\n${threadContent}`;
      }
      const model =
        SKILL_MODELS[skill] ??
        (PR_URL_PATTERN.test(threadContent) || MR_URL_PATTERN.test(threadContent) || REVIEW_KEYWORD_PATTERN.test(text) ? REVIEW_MODEL : undefined);

      const rawContext = isMemoryReadable(config)
        ? await getGlobalContext(config.s3!).catch((err) => {
            console.error("[memory] Failed to load global context:", err);
            return null;
          })
        : null;
      const memoryContext = rawContext ? truncateForInjection(rawContext) : null;

      const customTools = createSlackTools(client);
      const { text: response, cost, tokens, error } = await runAgent({
        threadContent,
        images: threadImages.length > 0 ? threadImages : undefined,
        triggeredBy: `${userName} (slack_user_id: ${event.user ?? "unknown"})`,
        model,
        memoryContext: memoryContext ?? undefined,
        customTools,
      });
      await syncAuth();
      if (skill === "schedule") {
        patchScheduleChannels(event.channel);
      }

      const userIsGuest = event.user ? await isExternalOrGuest(client, event.user) : true;
      if (isChannelEligibleForMemory(event.channel, config) && response && !userIsGuest) {
        triggerMemoryUpdate(config, event.channel, threadTs, threadContent, response).catch((err) =>
          console.error("[memory] Unhandled error in triggerMemoryUpdate:", err)
        );
      }

      await unreact("hourglass_flowing_sand");
      if (response) {
        await react("white_check_mark");

        // Check whether the agent embedded an <upload_file …/> directive.
        const uploadDirective = extractFileUploadTag(response);
        const displayResponse = uploadDirective ? uploadDirective.strippedText : response;

        if (uploadDirective) {
          // Upload the file first, then post the (stripped) text summary below.
          await uploadAgentFile(client, uploadDirective, event.channel, threadTs);
        }

        if (displayResponse.length > LARGE_RESPONSE_THRESHOLD) {
          pendingResponses.set(threadTs, displayResponse);
          const lines = displayResponse.split("\n").length;
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
        } else if (displayResponse) {
          await say({ text: markdownToMrkdwn(displayResponse), thread_ts: threadTs });
        }
      } else {
        await react("warning");
        const errDetail = error
          ? `I wasn't able to produce a response (error ${error.code}: ${sanitizeForSlack(error.message)}).`
          : "I wasn't able to produce a response.";
        await say({ text: errDetail, thread_ts: threadTs });
      }

      if (config.logChannelId) {
        postAuditLog(client, config.logChannelId, event, text, { status: "ok", cost, tokens })
          .catch((err) => console.error("[slack] Failed to post audit log:", err));
      }
    });

    if (submission.status === "queued-behind-thread") {
      await say({ text: "I'm still working on your previous request in this thread — your new message is queued.", thread_ts: threadTs });
    } else if (submission.queued) {
      const pos = submission.queuePosition + 1;
      const eta = submission.estimatedWaitSec;
      const etaText = eta > 0 ? ` (estimated wait: ~${formatEta(eta)})` : "";
      const msg = await say({
        text: `Your request is queued (position #${pos})${etaText} — I'll get to it shortly.`,
        thread_ts: threadTs,
      });
      if (msg?.ts) {
        queuedMessages.set(threadTs, { channel: event.channel, messageTs: msg.ts });
      }
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

  app.event("message", async ({ event, client, say }) => {
    const e = event as any;
    if (e.bot_id || e.subtype === "bot_message") {
      console.log("[slack][debug] Bot message event:", JSON.stringify({ subtype: e.subtype, bot_id: e.bot_id, text: e.text, hasAttachments: !!e.attachments, attachmentCount: e.attachments?.length, hasBlocks: !!e.blocks, blockCount: e.blocks?.length, keys: Object.keys(e) }, null, 2));
    }
    const { handle, isAutoReply: isAutoReplyChannel, skill: autoReplySkill, reason } = shouldHandleMessage(e, config.autoReplyChannels);
    if (!handle) {
      console.log(`[slack] Skipped message in ${e.channel} from ${e.user ?? e.bot_id ?? "unknown"}: ${reason}`);
      return;
    }

    if (e.user && await isExternalOrGuest(client, e.user)) {
      console.warn(`[slack] Denied request from non-org user ${e.user}`);
      await say({ text: "Sorry, I'm not available for external or guest users.", thread_ts: e.ts });
      return;
    }

    const text = extractEventText(e);
    const threadTs: string = isAutoReplyChannel ? e.ts : (e.thread_ts || e.ts);

    // "status" command — reply with cached rate limits, no agent needed
    if (/^\s*status\s*$/i.test(text.replace(/<@[A-Z0-9]+>/g, "").trim())) {
      await say({ text: getStatusMessage(), thread_ts: threadTs });
      return;
    }

    function react(name: string): Promise<unknown> {
      return client.reactions.add({ channel: e.channel, timestamp: e.ts, name })
        .catch((err) => { if (err.data?.error !== "already_reacted" && err.data?.error !== "message_not_found") throw err; });
    }
    function unreact(name: string): Promise<unknown> {
      return client.reactions.remove({ channel: e.channel, timestamp: e.ts, name })
        .catch((err) => { if (err.data?.error !== "no_reaction" && err.data?.error !== "message_not_found") throw err; });
    }

    // --- Auto-reply channel: route through the channel scheduler (same as app_mention) ---
    if (isAutoReplyChannel) {
      const [userName, channelName] = await Promise.all([
        e.user ? resolveUserName(client, e.user) : Promise.resolve(e.bot_profile?.name ?? e.username ?? "bot"),
        resolveChannelName(client, e.channel),
      ]);
      const skill = autoReplySkill!;
      console.log(`[slack] Auto-reply in #${channelName} from ${userName} [skill: ${skill}]: ${text}`);

      const submission = scheduler.submit(threadTs, async () => {
        await react("hourglass_flowing_sand");

        const fetchResult = await fetchThread(client, e.channel, threadTs);
        let threadContent = fetchResult.content;
        const threadImages = fetchResult.images;
        if (skill === "schedule") {
          threadContent = `[Schedule Context] channel: ${e.channel}\n\n${threadContent}`;
        }
        const model =
          SKILL_MODELS[skill] ??
          (PR_URL_PATTERN.test(threadContent) || MR_URL_PATTERN.test(threadContent) || REVIEW_KEYWORD_PATTERN.test(text) ? REVIEW_MODEL : undefined);

        const rawContext = isMemoryReadable(config)
          ? await getGlobalContext(config.s3!).catch((err) => {
              console.error("[memory] Failed to load global context:", err);
              return null;
            })
          : null;
        const memoryContext = rawContext ? truncateForInjection(rawContext) : null;

        const customTools = createSlackTools(client);
        const { text: response, cost, tokens, error } = await runAgent({
          threadContent,
          images: threadImages.length > 0 ? threadImages : undefined,
          triggeredBy: `${userName} (slack_user_id: ${e.user ?? "unknown"})`,
          model,
          memoryContext: memoryContext ?? undefined,
          customTools,
        });
        await syncAuth();
        if (skill === "schedule") {
          patchScheduleChannels(e.channel);
        }

        const userIsGuest = e.user ? await isExternalOrGuest(client, e.user) : true;
        if (isChannelEligibleForMemory(e.channel, config) && response && !userIsGuest) {
          triggerMemoryUpdate(config, e.channel, threadTs, threadContent, response).catch((err) =>
            console.error("[memory] Unhandled error in triggerMemoryUpdate:", err)
          );
        }

        await unreact("hourglass_flowing_sand");

        // NO_OUTPUT means the agent decided this message is not relevant (e.g. not a release)
        if (!response || response.trim().startsWith("NO_OUTPUT")) {
          if (!response) {
            await react("warning");
            const errDetail = error
              ? `I wasn't able to produce a response (error ${error.code}: ${sanitizeForSlack(error.message)}).`
              : "I wasn't able to produce a response.";
            await say({ text: errDetail, thread_ts: threadTs });
          }
          // For NO_OUTPUT, silently do nothing
          return;
        }

        await react("white_check_mark");

        const uploadDirective = extractFileUploadTag(response);
        const displayResponse = uploadDirective ? uploadDirective.strippedText : response;

        if (uploadDirective) {
          await uploadAgentFile(client, uploadDirective, e.channel, threadTs);
        }

        if (displayResponse.length > LARGE_RESPONSE_THRESHOLD) {
          pendingResponses.set(threadTs, displayResponse);
          const lines = displayResponse.split("\n").length;
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
        } else if (displayResponse) {
          await say({ text: markdownToMrkdwn(displayResponse), thread_ts: threadTs });
        }

        if (config.logChannelId) {
          postAuditLog(client, config.logChannelId, { channel: e.channel, ts: e.ts, user: e.user }, text, { status: "ok", cost, tokens })
            .catch((err) => console.error("[slack] Failed to post audit log:", err));
        }
      });

      if (submission.status === "queued-behind-thread") {
        await say({ text: "I'm still working on your previous request in this thread — your new message is queued.", thread_ts: threadTs });
      } else if (submission.queued) {
        const pos = submission.queuePosition + 1;
        const eta = submission.estimatedWaitSec;
        const etaText = eta > 0 ? ` (estimated wait: ~${formatEta(eta)})` : "";
        const msg = await say({
          text: `Your request is queued (position #${pos})${etaText} — I'll get to it shortly.`,
          thread_ts: threadTs,
        });
        if (msg?.ts) {
          queuedMessages.set(threadTs, { channel: e.channel, messageTs: msg.ts });
        }
      }

      submission.done.catch(async (err) => {
        const message = err instanceof Error ? err.message : "Unknown error occurred";
        console.error("[slack] Auto-reply agent error:", err);
        await unreact("hourglass_flowing_sand");
        await react("x");
        await say({ text: `Something went wrong: ${message}`, thread_ts: threadTs });

        if (config.logChannelId) {
          postAuditLog(client, config.logChannelId, { channel: e.channel, ts: e.ts, user: e.user }, text, { status: "error", error: message })
            .catch((e) => console.error("[slack] Failed to post audit log:", e));
        }
      });

      return;
    }

    // --- DM handling (existing logic) ---
    const userName = await resolveUserName(client, e.user);
    const skill = detectSkill(text);
    console.log(`[slack] DM from ${userName} [skill: ${skill}]`);

    const { done, position } = dmScheduler.submit(e.user, async () => {
      await react("hourglass_flowing_sand");

      const fetchResult = await fetchThread(client, e.channel, threadTs);
      let threadContent = fetchResult.content;
      const threadImages = fetchResult.images;
      if (skill === "schedule") {
        threadContent = `[Schedule Context] channel: ${e.channel}\n\n${threadContent}`;
      }
      const model =
        SKILL_MODELS[skill] ??
        (PR_URL_PATTERN.test(threadContent) || REVIEW_KEYWORD_PATTERN.test(text) ? REVIEW_MODEL : undefined);

      const rawContext = isMemoryReadable(config)
        ? await getGlobalContext(config.s3!).catch((err) => {
            console.error("[memory] Failed to load global context for DM:", err);
            return null;
          })
        : null;
      const memoryContext = rawContext ? truncateForInjection(rawContext) : null;

      const customTools = createSlackTools(client);
      const { text: response, cost, tokens, error } = await runAgent({ threadContent, images: threadImages.length > 0 ? threadImages : undefined, triggeredBy: userName, model, memoryContext: memoryContext ?? undefined, customTools, quiet: true });
      await syncAuth();
      if (skill === "schedule") {
        patchScheduleChannels(e.channel);
      }

      await unreact("hourglass_flowing_sand");
      if (response) {
        await react("white_check_mark");

        const uploadDirective = extractFileUploadTag(response);
        const displayResponse = uploadDirective ? uploadDirective.strippedText : response;

        if (uploadDirective) {
          await uploadAgentFile(client, uploadDirective, e.channel, threadTs);
        }

        if (displayResponse.length > LARGE_RESPONSE_THRESHOLD) {
          pendingResponses.set(threadTs, displayResponse);
          const lines = displayResponse.split("\n").length;
          await say({
            thread_ts: threadTs,
            text: "This response is long — choose a format:",
            blocks: [
              { type: "section", text: { type: "mrkdwn", text: `This response is long (~${lines} lines). How would you like to receive it?` } },
              { type: "actions", elements: [
                { type: "button", text: { type: "plain_text", text: "File (.md)" }, action_id: "deliver_file", value: threadTs },
                { type: "button", text: { type: "plain_text", text: "Inline message" }, action_id: "deliver_message", value: threadTs },
              ]},
            ],
          } as any);
        } else if (displayResponse) {
          await say({ text: markdownToMrkdwn(displayResponse), thread_ts: threadTs });
        }
      } else {
        await react("warning");
        const errDetail = error
          ? `I wasn't able to produce a response (error ${error.code}: ${sanitizeForSlack(error.message)}).`
          : "I wasn't able to produce a response.";
        await say({ text: errDetail, thread_ts: threadTs });
      }

      if (config.logChannelId) {
        postAuditLog(client, config.logChannelId, { channel: e.channel, ts: e.ts, user: e.user }, text, { status: "ok", cost, tokens })
          .catch((err) => console.error("[slack] Failed to post audit log:", err));
      }
    });

    if (position > 0) {
      await say({ text: `I'm busy but your request is queued (#${position + 1}) — I'll get to it shortly.`, thread_ts: threadTs });
    }

    done.catch(async (err) => {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      console.error("[slack] DM agent error:", err);
      await client.reactions.remove({ channel: e.channel, timestamp: e.ts, name: "hourglass_flowing_sand" }).catch(() => {});
      await client.reactions.add({ channel: e.channel, timestamp: e.ts, name: "x" }).catch(() => {});
      await say({ text: `Something went wrong: ${message}`, thread_ts: threadTs });

      if (config.logChannelId) {
        postAuditLog(client, config.logChannelId, { channel: e.channel, ts: e.ts, user: e.user }, text, { status: "error", error: message })
          .catch((err2) => console.error("[slack] Failed to post audit log:", err2));
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

/** Parsed file-upload directive emitted by the agent. */
export interface FileUploadDirective {
  /** Absolute path to the file on disk (e.g. `/tmp/results.csv`) */
  path: string;
  /** Filename to show in Slack (e.g. `active_wallets_2026.csv`) */
  filename: string;
  /** Agent response with the `<upload_file …/>` tag stripped out */
  strippedText: string;
}

const UPLOAD_FILE_TAG = /<upload_file\s+path="([^"]+)"\s+filename="([^"]+)"\s*\/?>/i;

/**
 * Detect and extract an `<upload_file path="…" filename="…"/>` tag from the
 * agent response.  Returns `null` when no tag is present.
 */
export function extractFileUploadTag(response: string): FileUploadDirective | null {
  const match = UPLOAD_FILE_TAG.exec(response);
  if (!match) return null;
  return {
    path: match[1],
    filename: match[2],
    strippedText: response.replace(UPLOAD_FILE_TAG, "").trim(),
  };
}

/**
 * Upload a file produced by the agent to Slack and post a short summary
 * message in the thread.  The caller is responsible for also posting
 * `strippedText` (the response without the tag).
 */
async function uploadAgentFile(
  client: WebClient,
  directive: FileUploadDirective,
  channel: string,
  threadTs: string
): Promise<void> {
  let content: Buffer;
  try {
    content = await readFile(directive.path);
  } catch (err) {
    console.error(`[slack] Could not read agent file at ${directive.path}:`, err);
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `⚠️ I tried to attach \`${directive.filename}\` but the file was not found on disk.`,
    });
    return;
  }

  await client.files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    content: content.toString("utf-8"),
    filename: directive.filename,
    title: directive.filename,
  });
}

const MAX_ERROR_LENGTH = 200;

function sanitizeForSlack(text: string): string {
  const escaped = text.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
  return escaped.length > MAX_ERROR_LENGTH ? escaped.slice(0, MAX_ERROR_LENGTH) + "…" : escaped;
}

export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
}

export async function fetchThread(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<{ content: string; images: ImageContent[] }> {
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

  const allImages: ImageContent[] = [];

  const parts = await Promise.all(
    messages.map(async (m) => {
      const anyM = m as any;
      const name = userNames.get(m.user || "") || anyM.bot_profile?.name || anyM.username || "unknown";
      const ts = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "";
      let content = `[${name}] (${ts}): ${extractEventText(m)}`;

      const files: any[] = (m as any).files || [];
      for (const file of files) {
        const ext = file.name?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
        if (TEXT_MIMETYPES.has(file.mimetype) || TEXT_EXTENSIONS.has(ext)) {
          const fileContent = await downloadTextFile(file.url_private_download);
          if (fileContent) {
            content += `\n[Attached file: ${file.name}]\n${fileContent}\n[/Attached file]`;
          }
        } else if (IMAGE_MIMETYPES.has(file.mimetype)) {
          const imageData = await downloadImageFile(file.url_private_download ?? file.url_private);
          if (imageData) {
            allImages.push({ type: "image", data: imageData, mimeType: file.mimetype });
            content += `\n[Attached image: ${file.name ?? "image"}]`;
          }
        }
      }

      return content;
    }),
  );

  return { content: parts.join("\n"), images: allImages };
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

async function downloadImageFile(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok) return "";
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch {
    return "";
  }
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  return `${mins}min`;
}

export function detectSkill(text: string): string {
  const t = text.toLowerCase().trimStart();
  if (/^shape(\s+up)?[\s:]/.test(t)) return "shape";
  if (/\bmr[\s-]?review\b/.test(t) || (/\bmerge[\s-]?request\b/.test(t) && /\breview\b/.test(t))) return "pr-review";
  if (/\bpr[\s-]?review\b/.test(t) || (/\breview\b/.test(t) && /\bpr\b/.test(t))) return "pr-review";
  if (/\btriage\b/.test(t)) return "triage";
  if (/\bcreate\b.+\bissue\b/.test(t) || /\bopen\b.+\bissue\b/.test(t)) return "create-issue";
  if (/^fix\b/.test(t)) return "fix";
  if (/^s[ch]edule[\s:]/.test(t) || /\bschedul\w*\b/.test(t) || /\blist\s+schedules\b/.test(t)) return "schedule";
  if (/\bsentry\b/.test(t)) return "sentry";
  if (/\bcheck\b.+\b(ab|asset\s*bundles?)\b/.test(t) || /\bab\s+(status|queue|pipeline|conversion)\b/.test(t) || /\b(scene|ab)\s+conversion\b/.test(t)) return "ab-status";
  if (/\bcheck\b.+\bpointer\b/.test(t) || /\bpointer\s+consistency\b/.test(t) || /\bcheck\b.+\bwearables\b/.test(t)) return "dcl-consistency";
  if (/^data[\s:]/.test(t)) return "data-query";
  if (/\bunban\b/.test(t) || /\bcredits?\s+ban\b/.test(t) || /\bban\s+status\b/.test(t)) return "credits-unban";
  if (/\bpipeline\b/.test(t) || /\bci(?:[\s/,.!?]|$)/.test(t) || /\bworkflow\b/.test(t) || /\bbuild\s+fail/.test(t)) return "pipeline";
  if (/\breconvert\b/.test(t) || /\bab[\s-]?reconver/.test(t) || /\bqueue[\s-]?ab\b/.test(t) || /\basset[\s-]?bundle[\s-]?reconver/.test(t) || /\bqueue-ab-conversion\b/.test(t)) return "ab-reconvert";
  if (/\brelease[\s-]?review\b/.test(t) || /\breview\b.+\brelease\b/.test(t)) return "release-review";
  if (/\b(aws|cloud)\s*(cost|spend|billing|budget|infra)\b/.test(t) || /\bcost\s*(explorer|anomal\w*|breakd\w*|forecast)\b/.test(t) || /\b(spend|billing)\b.{0,20}\b(aws|cloud|cost|account|budget|ec2|ecs|rds|s3|lambda)\b/.test(t) || /\bhow\s+m(any|uch)\b.+\b(ec2|ecs|rds|s3|lambda|server|instance|bucket|service|fargate)\b/.test(t) || /\binfra(structure)?\s*(cost|overview|inventory|summary)\b/.test(t)) return "aws-infra";
  return "general";
}


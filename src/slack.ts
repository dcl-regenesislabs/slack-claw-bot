import { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { Config } from "./config.js";
import { runAgent, syncAuth } from "./agent.js";
import { AgentScheduler } from "./concurrency.js";

const nameCache = new Map<string, string>();
const pendingResponses = new Map<string, string>();

const LARGE_RESPONSE_THRESHOLD = 2000;
const TEXT_MIMETYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);

let botToken: string;
let notionToken: string | undefined;

export async function startSlackBot(config: Config): Promise<void> {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });

  botToken = config.slackBotToken;
  notionToken = config.notionToken;
  if (config.notionShapeDbId) process.env.NOTION_SHAPE_DB_ID = config.notionShapeDbId;
  if (config.notionShapeParentId) process.env.NOTION_SHAPE_PARENT_ID = config.notionShapeParentId;
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

    const [userName, channelName] = await Promise.all([
      event.user ? resolveUserName(client, event.user) : Promise.resolve("unknown"),
      resolveChannelName(client, event.channel),
    ]);
    const skill = detectSkill(text);
    console.log(`[slack] Triggered by ${userName} in #${channelName} [skill: ${skill}]: ${text}`);

    function react(name: string): Promise<unknown> {
      return client.reactions.add({ channel: event.channel, timestamp: event.ts, name });
    }
    function unreact(name: string): Promise<unknown> {
      return client.reactions.remove({ channel: event.channel, timestamp: event.ts, name });
    }

    const submission = scheduler.submit(threadTs, async () => {
      await react("hourglass_flowing_sand");

      const threadContent = await fetchThread(client, event.channel, threadTs);

      // If any URL in the current message is inaccessible, report and skip the agent
      const urlErrors = extractCurrentMsgErrors(text, threadContent);
      if (urlErrors.length > 0) {
        await say({ text: urlErrors.join("\n"), thread_ts: threadTs });
        await unreact("hourglass_flowing_sand");
        await react("warning");
        return;
      }

      const { text: response, cost, tokens } = await runAgent({ threadContent, triggeredBy: userName });
      await syncAuth();

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

      for (const url of extractUrls(m.text || "")) {
        if (isNotionUrl(url)) {
          const pageContent = await fetchNotionPage(url);
          if (pageContent) content += `\n[Notion page: ${url}]\n${pageContent}\n[/Notion page]`;
        } else {
          const pageContent = await fetchWebPage(url);
          if (pageContent) content += `\n[Web page: ${url}]\n${pageContent}\n[/Web page]`;
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
  return "general";
}

function extractCurrentMsgErrors(messageText: string, threadContent: string): string[] {
  const urls = extractUrls(messageText);
  const errors: string[] = [];
  for (const url of urls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\[(?:Notion page|Web page): ${escaped}\\][\\s\\S]*?\\[Error: ([^\\]]+)\\]`);
    const match = threadContent.match(pattern);
    if (match) errors.push(`⚠️ ${match[1]}`);
  }
  return [...new Set(errors)];
}

function extractUrls(text: string): string[] {
  // Matches Slack-encoded <https://url|label> and bare https:// URLs
  const matches = [...text.matchAll(/<(https?:\/\/[^|>]+)[|>]|(https?:\/\/[^\s>]+)/g)];
  const urls = matches.map((m) => m[1] || m[2]).filter(Boolean) as string[];
  // Deduplicate and skip internal Slack URLs
  return [...new Set(urls)].filter((u) => !u.includes("slack.com"));
}

function isNotionUrl(url: string): boolean {
  return /notion\.so/.test(url);
}

function extractNotionPageId(url: string): string | null {
  const match = url.match(/([a-f0-9]{32})(?:[?#]|$)/i) || url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:[?#]|$)/i);
  return match ? match[1].replace(/-/g, "") : null;
}

async function fetchNotionPage(url: string): Promise<string> {
  if (!notionToken) return "[Error: NOTION_TOKEN is not configured — cannot read this Notion page]";
  const pageId = extractNotionPageId(url);
  if (!pageId) return "[Error: Could not extract a valid Notion page ID from this URL]";

  const headers = {
    Authorization: `Bearer ${notionToken}`,
    "Notion-Version": "2022-06-28",
  };

  try {
    // Try as a page first; fall back to database if 404 (database view URLs share the same ID)
    let pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
    let isDatabase = false;
    if (pageRes.status === 404) {
      pageRes = await fetch(`https://api.notion.com/v1/databases/${pageId}`, { headers });
      isDatabase = true;
    }

    if (pageRes.status === 401 || pageRes.status === 403) {
      return "[Error: Access denied to this Notion page — make sure the integration has been invited to this page]";
    }
    if (pageRes.status === 404) {
      return "[Error: Notion page not found — the page may be private or the URL may be incorrect]";
    }
    if (!pageRes.ok) {
      return `[Error: Could not read Notion page (HTTP ${pageRes.status})]`;
    }

    const page = await pageRes.json() as any;

    // For databases, fetch rows instead of blocks
    let blocks: any = { results: [] };
    if (isDatabase) {
      const rowsRes = await fetch(`https://api.notion.com/v1/databases/${pageId}/query`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ page_size: 50 }),
      });
      if (rowsRes.ok) blocks = await rowsRes.json();
    } else {
      const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
      if (!blocksRes.ok) return `[Error: Could not read Notion page blocks (HTTP ${blocksRes.status})]`;
      blocks = await blocksRes.json();
    }

    const title = page.title?.[0]?.plain_text
      || page.properties?.title?.title?.[0]?.plain_text
      || page.properties?.Name?.title?.[0]?.plain_text
      || "Untitled";

    const text = (blocks.results as any[])
      .map(blocksToText)
      .filter(Boolean)
      .join("\n");

    return `# ${title}\n\n${text}`.slice(0, 12000);
  } catch {
    return "[Error: Failed to fetch Notion page — network error or timeout]";
  }
}

function blocksToText(block: any): string {
  const richText = (arr: any[]): string => arr?.map((t: any) => t.plain_text).join("") ?? "";
  switch (block.type) {
    case "paragraph": return richText(block.paragraph?.rich_text);
    case "heading_1": return `# ${richText(block.heading_1?.rich_text)}`;
    case "heading_2": return `## ${richText(block.heading_2?.rich_text)}`;
    case "heading_3": return `### ${richText(block.heading_3?.rich_text)}`;
    case "bulleted_list_item": return `- ${richText(block.bulleted_list_item?.rich_text)}`;
    case "numbered_list_item": return `1. ${richText(block.numbered_list_item?.rich_text)}`;
    case "code": return `\`\`\`\n${richText(block.code?.rich_text)}\n\`\`\``;
    case "quote": return `> ${richText(block.quote?.rich_text)}`;
    case "callout": return richText(block.callout?.rich_text);
    default: return "";
  }
}

async function fetchWebPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) {
      return "[Error: This page is private or requires authentication — cannot read its contents]";
    }
    if (res.status === 404) {
      return "[Error: Page not found (404)]";
    }
    if (!res.ok) {
      return `[Error: Could not fetch page (HTTP ${res.status})]`;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/")) return "";
    const html = await res.text();
    return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  } catch {
    return "[Error: Failed to fetch page — network error or timeout]";
  }
}

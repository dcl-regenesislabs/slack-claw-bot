import { Type, type Static } from "@sinclair/typebox";
import type { WebClient } from "@slack/web-api";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { extractEventText } from "../slack.js";

const DEFAULT_LIMIT = 50;

const SLACK_LINK_RE =
  /slack\.com\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/;

export function parseSlackUrl(
  url: string,
): { channel: string; threadTs: string } | null {
  const m = url.match(SLACK_LINK_RE);
  if (!m) return null;
  return { channel: m[1], threadTs: `${m[2]}.${m[3]}` };
}

const Parameters = Type.Object({
  url: Type.Optional(
    Type.String({ description: "Slack permalink URL to a message or thread" }),
  ),
  channel: Type.Optional(
    Type.String({ description: "Channel ID (alternative to url)" }),
  ),
  thread_ts: Type.Optional(
    Type.String({
      description: "Thread timestamp (alternative to url)",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 200,
      default: DEFAULT_LIMIT,
      description:
        "Maximum number of messages to fetch (default 50). The most recent messages are returned.",
    }),
  ),
});

async function resolveUserNames(
  client: WebClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const info = await client.users.info({ user: uid });
        names.set(uid, info.user?.real_name || info.user?.name || uid);
      } catch {
        names.set(uid, uid);
      }
    }),
  );
  return names;
}

function formatMessages(
  messages: any[],
  userNames: Map<string, string>,
): string {
  return messages
    .map((m) => {
      const name = userNames.get(m.user || "") || m.bot_profile?.name || m.username || "unknown";
      const ts = m.ts
        ? new Date(parseFloat(m.ts) * 1000).toISOString()
        : "";
      return `[${name}] (${ts}): ${extractEventText(m)}`;
    })
    .join("\n");
}

export function createSlackTools(client: WebClient): ToolDefinition[] {
  const tool: ToolDefinition = {
    name: "read_slack_thread",
    label: "Read Slack Thread",
    description:
      "Fetches messages from a Slack thread given a permalink URL or a channel ID + thread timestamp. " +
      "Use this when a user shares a Slack link or asks you to read a conversation from another channel.",
    promptSnippet:
      "Read messages from a Slack thread by URL or channel+timestamp",
    promptGuidelines: [
      "Use read_slack_thread when the user shares a Slack permalink or asks you to read a Slack conversation.",
      "Prefer the `url` parameter when a permalink is available. Fall back to `channel` + `thread_ts` for programmatic access.",
      "The bot can only read channels it has been invited to. If the tool returns an access error, tell the user to invite the bot to the channel.",
    ],
    parameters: Parameters,
    async execute(_toolCallId, params: Static<typeof Parameters>) {
      let channel: string | undefined;
      let threadTs: string | undefined;

      if (params.url) {
        const parsed = parseSlackUrl(params.url);
        if (!parsed) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Could not parse Slack URL: ${params.url}. Expected format: https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<TIMESTAMP>`,
              },
            ],
            details: {},
          };
        }
        channel = parsed.channel;
        threadTs = parsed.threadTs;
      } else if (params.channel && params.thread_ts) {
        channel = params.channel;
        threadTs = params.thread_ts;
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide either a `url` or both `channel` and `thread_ts` parameters.",
            },
          ],
          details: {},
        };
      }

      const limit = params.limit ?? DEFAULT_LIMIT;

      try {
        const reply = await client.conversations.replies({
          channel: channel!,
          ts: threadTs!,
          limit: 200,
        });

        const allMessages = reply.messages || [];
        // Take the most recent N messages
        const messages =
          allMessages.length > limit
            ? allMessages.slice(-limit)
            : allMessages;

        const uniqueUserIds = [
          ...new Set(
            messages
              .map((m) => m.user)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const userNames = await resolveUserNames(client, uniqueUserIds);
        const formatted = formatMessages(messages, userNames);

        const header =
          allMessages.length > limit
            ? `Showing last ${limit} of ${allMessages.length} messages:\n\n`
            : "";

        return {
          content: [{ type: "text" as const, text: header + formatted }],
          details: {},
        };
      } catch (err: any) {
        const code = err?.data?.error || err?.message || "unknown_error";
        const friendly: Record<string, string> = {
          channel_not_found:
            "Channel not found. The channel may not exist or the bot may not have access.",
          not_in_channel:
            "The bot is not a member of this channel. Invite the bot to the channel first.",
          thread_not_found:
            "Thread not found. The link may be invalid or the message may have been deleted.",
        };
        const message =
          friendly[code] || `Failed to read Slack thread: ${code}`;
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: {},
        };
      }
    },
  };

  return [tool];
}

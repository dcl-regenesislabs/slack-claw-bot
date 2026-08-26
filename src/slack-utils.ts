/** Shared Slack text-extraction utilities.
 *  Standalone module so slack.ts and future tool modules can share them without
 *  circular imports.
 */

/** Slack renders text either bare or wrapped in a text object — `{ text: "…" }`. */
type SlackText = string | { text?: string } | undefined;

interface SlackBlockElement {
  type?: string;
  text?: SlackText;
  url?: string;
  elements?: SlackBlockElement[];
}

export interface SlackBlock {
  type?: string;
  text?: SlackText;
  elements?: SlackBlockElement[];
  fields?: SlackText[];
}

function textOf(value: SlackText): string {
  if (typeof value === "string") return value;
  return value?.text ?? "";
}

export function extractBlockText(blocks: SlackBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    parts.push(textOf(block.text));
    // rich_text blocks nest their content one or two levels deep
    for (const el of block.elements ?? []) {
      for (const inner of el.elements ?? []) {
        parts.push(textOf(inner.text));
        if (inner.url) parts.push(inner.url);
      }
      parts.push(textOf(el.text));
    }
    for (const field of block.fields ?? []) {
      parts.push(textOf(field));
    }
  }
  return parts.filter(Boolean).join("\n").trim();
}

/** Extract readable text from a Slack message/event, merging text, attachments, and blocks.
 *  Bot/webhook messages (GitHub, CI) often carry all content in attachments or blocks with
 *  an empty `text` — reading only `.text` renders them as blank lines in the transcript. */
export function extractEventText(event: {
  text?: string;
  attachments?: Array<{ text?: string; fallback?: string; pretext?: string }>;
  blocks?: SlackBlock[];
}): string {
  const parts: string[] = [];
  if (event.text?.trim()) parts.push(event.text.trim());
  if (event.attachments?.length) {
    const att = event.attachments
      .map((a) => [a.pretext, a.text, a.fallback].filter(Boolean).join("\n"))
      .join("\n")
      .trim();
    if (att) parts.push(att);
  }
  if (event.blocks?.length) {
    const blk = extractBlockText(event.blocks);
    if (blk) parts.push(blk);
  }
  return parts.join("\n").trim();
}

/** Convert the agent's markdown to Slack mrkdwn (bold + links). */
export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
}

/** Shared Slack text-extraction utilities.
 *  Extracted into a standalone module to avoid circular imports between
 *  slack.ts and tools/read-slack-thread.ts.
 */

export function extractBlockText(blocks: Array<Record<string, any>>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.text) {
      // section / header blocks have { text: { text: "..." } } or { text: "..." }
      const t = typeof block.text === "string" ? block.text : block.text?.text;
      if (t) parts.push(t);
    }
    // rich_text blocks contain nested elements
    if (block.elements) {
      for (const el of block.elements) {
        if (el.elements) {
          for (const inner of el.elements) {
            if (inner.text) parts.push(inner.text);
            if (inner.url) parts.push(inner.url);
          }
        }
        if (el.text) parts.push(typeof el.text === "string" ? el.text : el.text?.text ?? "");
      }
    }
    if (block.fields) {
      for (const f of block.fields) {
        const t = typeof f === "string" ? f : f?.text;
        if (t) parts.push(t);
      }
    }
  }
  return parts.filter(Boolean).join("\n").trim();
}

/** Extract readable text from a Slack event, merging text, attachments, and blocks. */
export function extractEventText(event: { text?: string; attachments?: Array<{ text?: string; fallback?: string; pretext?: string }>; blocks?: Array<Record<string, any>> }): string {
  const parts: string[] = [];
  if (event.text?.trim()) parts.push(event.text.trim());
  if (event.attachments?.length) {
    const att = event.attachments
      .map(a => [a.pretext, a.text, a.fallback].filter(Boolean).join("\n"))
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

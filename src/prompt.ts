export interface FileAttachment {
  name: string;
  mimetype: string;
  url: string;
}

export function buildPrompt(
  threadContent: string,
  dryRun?: boolean,
  triggeredBy?: string,
  isFollowUp?: boolean,
  files?: FileAttachment[],
  channelName?: string,
): string {
  const dryRunNotice = dryRun
    ? "IMPORTANT: Do not execute any commands. Just describe what you would do.\n\n"
    : "";

  const attributionLines: string[] = [];
  if (channelName) attributionLines.push(`Channel: #${channelName}`);
  if (triggeredBy) attributionLines.push(`Triggered by: ${triggeredBy}`);
  const attribution = attributionLines.length
    ? `${attributionLines.join("\n")}\n\n`
    : "";

  const fileSection = files?.length
    ? "\n\n## Attached Files\n\n" + files
        .map((f) => `- **${f.name}** (${f.mimetype})\n  Download: \`curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" "${f.url}" -o "${f.name}"\``)
        .join("\n")
    : "";

  if (isFollowUp) {
    return `${dryRunNotice}${attribution}## New message in thread\n\n<slack-message>\n${threadContent}\n</slack-message>${fileSection}`;
  }

  return `${dryRunNotice}${attribution}## Slack Thread\n\n<slack-thread>\n${threadContent}\n</slack-thread>${fileSection}`;
}

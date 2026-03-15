export function buildPrompt(
  threadContent: string,
  dryRun?: boolean,
  triggeredBy?: string,
  isFollowUp?: boolean,
): string {
  const dryRunNotice = dryRun
    ? "IMPORTANT: Do not execute any commands. Just describe what you would do.\n\n"
    : "";

  const attribution = triggeredBy
    ? `Triggered by: ${triggeredBy}\n\n`
    : "";

  if (isFollowUp) {
    return `${dryRunNotice}${attribution}## New message in thread\n\n<slack-message>\n${threadContent}\n</slack-message>`;
  }

  return `${dryRunNotice}${attribution}## Slack Thread\n\n<slack-thread>\n${threadContent}\n</slack-thread>`;
}

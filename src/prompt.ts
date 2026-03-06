export function buildPrompt(threadContent: string, dryRun?: boolean, triggeredBy?: string): string {
  const dryRunNotice = dryRun
    ? "IMPORTANT: Do not execute any commands. Just describe what you would do.\n\n"
    : "";

  const attribution = triggeredBy
    ? `Triggered by: ${triggeredBy}\n\n`
    : "";

  return `${dryRunNotice}${attribution}## Slack Thread\n\n<slack-thread>\n${threadContent}\n</slack-thread>`;
}

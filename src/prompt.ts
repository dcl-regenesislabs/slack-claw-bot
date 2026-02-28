export function buildPrompt(threadContent: string, dryRun?: boolean): string {
  const dryRunNotice = dryRun
    ? "IMPORTANT: Do not execute any commands. Just describe what you would do.\n\n"
    : "";

  return `${dryRunNotice}## Slack Thread\n\n<slack-thread>\n${threadContent}\n</slack-thread>`;
}

export function buildPrompt(threadContent: string, dryRun?: boolean, triggeredBy?: string, mediaPaths?: string[]): string {
  const dryRunNotice = dryRun
    ? "IMPORTANT: Do not execute any commands. Just describe what you would do.\n\n"
    : "";

  const attribution = triggeredBy
    ? `Triggered by: ${triggeredBy}\n\n`
    : "";

  const mediaSection = mediaPaths?.length
    ? `\n\n## Attached Media\n\nThe following files from the Slack thread are saved to disk for upload:\n${mediaPaths.map((p) => `- ${p}`).join("\n")}\n`
    : "";

  return `${dryRunNotice}${attribution}## Slack Thread\n\n<slack-thread>\n${threadContent}\n</slack-thread>${mediaSection}`;
}

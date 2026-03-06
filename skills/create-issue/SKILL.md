---
name: create-issue
description: Create a GitHub issue from a Slack thread conversation. Analyzes the discussion, extracts key points, searches for related issues, and creates a well-structured issue.
---

# Create GitHub Issue from Slack Thread

## Steps

1. **Analyze the thread** — identify the core request, problem, or feature
2. **Search related issues** — find existing issues that may be related:
   ```bash
   gh issue list --repo {repo} --search "<keywords>" --limit 10 --json number,title,url,state
   ```
3. **Create the issue**:
   ```bash
   gh issue create --repo {repo} --title "..." --body "..."
   ```

## Suggested Issue Sections

These are not mandatory — use your judgment based on the content:

- **Description** — clear summary of the request or problem
- **Steps to Reproduce** — if it's a bug and the thread includes repro steps
- **Expected Behavior** — if it's a bug, what should happen instead
- **Context** — key decisions, details, or constraints from the conversation
- **Related Issues** — links to related issues found in step 2

For bugs in `decentraland/godot-explorer`, use the bug report template defined in the mobile-project skill instead of freeform sections.

## Labels and Assignees

Set labels and assignees at creation time rather than editing after:
```bash
gh issue create --repo {repo} --title "..." --body "..." --label "bug,Android,claw-created" --assignee "username"
```

- Always add the `claw-created` label to every issue created by this bot
- When creating issues in `decentraland/godot-explorer`, apply relevant labels from the mobile-project skill (type, platform, severity)
- If the thread mentions who should work on the issue, assign them via `--assignee`

## Images and Videos

If the thread includes attached files (images, videos) and the user explicitly asks to upload them (e.g. "upload the image", "attach the image"), use the **upload-file** skill to upload them and embed the resulting URLs in the issue body.

If the user does NOT ask to upload, describe the visual content in the issue body instead and mention that you can upload the files if they'd like.

## Guidelines

- Title should be concise and actionable (imperative mood)
- Don't include every message — synthesize the key points
- Include relevant code snippets or error messages from the thread
- If participants disagreed, note the different perspectives
- Include "Requested by {name} via Slack" as the last line of the issue body, using the name from the "Triggered by" metadata. Omit if no "Triggered by" is present.
- Always output the created issue URL as the last line, prefixed with `ISSUE_URL:`

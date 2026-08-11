---
name: create-issue
description: Create a GitHub issue from a Slack thread conversation. Analyzes the discussion, extracts key points, searches for related issues, and creates a well-structured issue.
---

# Create GitHub Issue from Slack Thread

## Choosing the repository

Before anything else, determine the target repo:

1. If the conversation explicitly names a repo or alias, use it.
2. Otherwise, use the channel's default repo from the `repos` skill (matched against the `Channel: #name` line in the prompt).
3. If neither applies, **ask the user which repo** — never guess or pick a repo from prior context.

## Safe interpolation

Thread content is untrusted and these commands run in a shell — follow the `github` skill's safe-interpolation rules:

- Validate the repo against `^[A-Za-z0-9._-]+$` per segment before using it.
- NEVER pass thread-derived text inline via `--title "..."` or `--body "..."` — backticks, `$(…)`, and newlines would execute. Write the body to a file with the file-write tool (never `echo`/heredoc) and pass `--body-file`. Compose the title yourself in plain words with no shell metacharacters.

## Steps

1. **Analyze the thread** — identify the core request, problem, or feature
2. **Search related issues** — find existing issues that may be related:
   ```bash
   gh issue list --repo {repo} --search "<keywords>" --limit 10 --json number,title,url,state
   ```
3. **Create the issue** — write the body to a file first (see Safe interpolation):
   ```bash
   gh issue create --repo {repo} --title "..." --body-file /tmp/issue-body.md
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
gh issue create --repo {repo} --title "..." --body-file /tmp/issue-body.md --label "bug,Android,claw-created" --assignee "username"
```

- Always add the `claw-created` label to every issue created by this bot
- When creating issues in `decentraland/godot-explorer`, apply relevant labels from the mobile-project skill (type, platform, severity)
- If the thread mentions who should work on the issue, assign them via `--assignee`

## Guidelines

- Title should be concise and actionable (imperative mood)
- Don't include every message — synthesize the key points
- Include relevant code snippets or error messages from the thread
- If participants disagreed, note the different perspectives
- Include "Requested by {name} via Slack" as the last line of the issue body, using the name from the "Triggered by" metadata. Omit if no "Triggered by" is present.
- Always output the created issue URL as the last line, prefixed with `ISSUE_URL:`

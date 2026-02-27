---
name: create-issue
description: Create a GitHub issue from a Slack thread conversation. Analyzes the discussion, extracts key points, searches for related issues, and creates a well-structured issue.
---

# Create GitHub Issue from Slack Thread

## Steps

1. **Analyze the thread** — identify the core request, problem, or feature
2. **Search related issues** — find existing issues that may be related:
   ```
   gh issue list --repo {repo} --search "<keywords>" --limit 10 --json number,title,url,state
   ```
3. **Create the issue**:
   ```
   gh issue create --repo {repo} --title "..." --body "..."
   ```

## Issue Body Structure

- **Description**: Clear summary of the request/problem from the thread
- **Context**: Key decisions or details from the conversation
- **Related Issues**: Links to related issues found in step 2
- **Source**: Note that this was created from a Slack thread

## Guidelines

- Title should be concise and actionable (imperative mood)
- Don't include every message — synthesize the key points
- Include relevant code snippets or error messages from the thread
- If participants disagreed, note the different perspectives
- Always output the created issue URL as the last line, prefixed with `ISSUE_URL:`

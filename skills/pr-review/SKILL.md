---
name: pr-review
description: Review GitHub pull requests and GitLab merge requests — read the diff, analyze code for bugs and issues, post review comments, and summarize findings.
---

# Pull Request / Merge Request Review

## GitHub Operations

### View PR details
```bash
gh pr view {number} -R {owner}/{repo} --json title,body,files,reviews,comments,state,statusCheckRollup
```

### Fetch the full diff
```bash
gh pr diff {number} -R {owner}/{repo}
```

### List changed files (summary)
```bash
gh pr diff {number} -R {owner}/{repo} --stat
```

### Check CI status
```bash
gh pr checks {number} -R {owner}/{repo}
```

### List recent PRs
```bash
gh pr list -R {owner}/{repo} --limit 10 --json number,title,author,state,url
```

### Read comments
```bash
# Inline review comments (attached to specific lines)
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | {user: .user.login, body: .body, path: .path, line: .line}'

# Top-level conversation comments
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {user: .user.login, body: .body}'
```

## GitLab Merge Request Operations

There are two GitLab groups, each with its own token:

| Group | API base | Token env var |
|-------|----------|---------------|
| `/dcl` | `https://dcl.tools/dcl/api/v4` | `GITLAB_TOKEN_DCL` |
| `/ops` | `https://dcl.tools/ops/api/v4` | `GITLAB_TOKEN_OPS` |

Select the correct token based on which group the MR belongs to. MR URLs look like:
- `https://dcl.tools/dcl/{project}/-/merge_requests/{iid}`
- `https://dcl.tools/ops/{project}/-/merge_requests/{iid}`

To build API URLs, extract the project path from the MR URL and URL-encode it (replace `/` with `%2F`). For example, `group/project` becomes `group%2Fproject`.

In the examples below, `$GITLAB_TOKEN` is a placeholder — substitute `$GITLAB_TOKEN_DCL` or `$GITLAB_TOKEN_OPS` based on the MR's group.

### View MR details
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests/${IID}"
```

### Fetch MR changes (diff)
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests/${IID}/changes"
```

The response includes a `diff_refs` object with `base_sha`, `start_sha`, and `head_sha` — you will need these for line-level comments.

### Check CI pipelines
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests/${IID}/pipelines"
```

### List recent MRs
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests?state=opened&per_page=10"
```

### Read discussions and comments
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests/${IID}/discussions"
```

### Post a general comment
```bash
curl -s --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"body": "Review summary..."}' \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests/${IID}/notes"
```

### Post line-level discussion
```bash
curl -s --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "body": "Bug: this will throw if user is null — add a guard check.",
    "position": {
      "base_sha": "<base_sha from diff_refs>",
      "start_sha": "<start_sha from diff_refs>",
      "head_sha": "<head_sha from diff_refs>",
      "position_type": "text",
      "new_path": "src/example.ts",
      "new_line": 42
    }
  }' \
  "https://dcl.tools/ops/api/v4/projects/${PROJECT_ID}/merge_requests/${IID}/discussions"
```

## Code review workflow

When asked to review a PR or MR (not just summarize):

### 1. Gather context

- Fetch PR/MR details (title, body, state, CI status)
- Fetch the full diff
- If needed, clone the repo to `tmp/` to read changed files in full context
- For GitLab MRs, use the curl-based operations above; for GitHub PRs, use the gh CLI operations

### 2. Analyze the code

Look for:
- *Bugs* — logic errors, off-by-one, null/undefined access, race conditions
- *Security issues* — injection, auth bypass, secrets in code, unsafe deserialization
- *Missing error handling* — unhandled promise rejections, missing try/catch, ignored errors
- *Test coverage* — are the changes tested? Are edge cases covered?
- *API contract* — breaking changes, missing validation, wrong HTTP methods
- *Performance* — N+1 queries, unnecessary allocations, missing pagination
- *Style* — only flag style issues if they affect readability or correctness

Reference specific files and lines when noting issues.

### 3. Post the review

For GitHub PRs, choose the appropriate review action:

```bash
# Approve
gh pr review {number} -R {owner}/{repo} --approve --body "Review summary..."

# Request changes
gh pr review {number} -R {owner}/{repo} --request-changes --body "Review summary..."

# Comment only (no approval decision)
gh pr review {number} -R {owner}/{repo} --comment --body "Review summary..."
```

For GitHub line-level comments, use the GitHub API:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST --input - <<'EOF'
{
  "event": "COMMENT",
  "body": "Overall review summary",
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "body": "Bug: this will throw if `user` is null — add a guard check."
    }
  ]
}
EOF
```

For GitLab MRs, post a general comment with the review summary and use line-level discussions for specific issues (see GitLab operations above).

### 4. Report back to Slack

Provide a concise summary:

1. **Verdict** — approved, changes requested, or comments only
2. **Key findings** — most important issues, grouped by severity
3. **CI status** — passing, failing, or pending
4. **Link** — the PR/MR URL

## Summary-only guidelines

When summarizing a PR (not doing a full review):

1. **What changed** — summarize the purpose and key changes (don't just list files)
2. **CI status** — note whether checks are passing, failing, or pending
3. **Review status** — approved, changes requested, or awaiting review
4. **Blockers** — flag anything preventing merge (failing CI, requested changes, `do not merge` label)
5. **Ready to merge?** — give a clear yes/no/not-yet assessment with reasoning

Keep summaries concise. Focus on what matters for deciding whether to merge.

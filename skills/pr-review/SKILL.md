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

The GitLab API is served at the instance root: `https://dcl.tools/api/v4`. There are two groups, each with its own access token:

| Group | Token env var |
|-------|---------------|
| `/dcl` | `GITLAB_TOKEN_DCL` |
| `/ops` | `GITLAB_TOKEN_OPS` |

Select the correct token based on which group the MR belongs to. MR URLs look like:
- `https://dcl.tools/dcl/{project}/-/merge_requests/{iid}`
- `https://dcl.tools/ops/{project}/-/merge_requests/{iid}`

To build API URLs, extract the **full project path** (including the group) from the MR URL and URL-encode it (replace `/` with `%2F`). For example, for `https://dcl.tools/ops/infra/deploy/-/merge_requests/42`, the encoded project path is `ops%2Finfra%2Fdeploy`.

In the examples below:
- `$GITLAB_TOKEN` is a placeholder — substitute `$GITLAB_TOKEN_DCL` or `$GITLAB_TOKEN_OPS` based on the MR's group
- `$PROJECT_PATH` is the URL-encoded full project path (e.g. `ops%2Finfra%2Fdeploy`)

### View MR details
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests/${IID}"
```

### Fetch MR changes (diff)
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests/${IID}/changes"
```

The response includes a `diff_refs` object with `base_sha`, `start_sha`, and `head_sha` — you will need these for line-level comments.

### Check CI pipelines
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests/${IID}/pipelines"
```

### List recent MRs
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests?state=opened&per_page=10"
```

### Read discussions and comments
```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests/${IID}/discussions"
```

### Post a general comment
```bash
curl -s --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"body": "Review summary..."}' \
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests/${IID}/notes"
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
  "https://dcl.tools/api/v4/projects/${PROJECT_PATH}/merge_requests/${IID}/discussions"
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
- *Missing error handling* — unhandled promise rejections, missing try/catch, ignored errors
- *Unused imports* — flag any imports that are no longer referenced after the changes
- *Test coverage* — are the changes tested? Are edge cases covered?
- *API contract* — breaking changes, missing validation, wrong HTTP methods
- *Performance* — N+1 queries, unnecessary allocations, missing pagination
- *Style* — only flag style issues if they affect readability or correctness

Reference specific files and lines when noting issues.

### 2b. Run review sub-agents in parallel

Read the `workflows-review` skill and run specialized review agents on the PR:

```bash
cat skills/workflows-review/SKILL.md
```

**Execute the parallel review steps from that skill.** Pass the PR diff and context to each agent. The sub-agents provide deep specialized analysis (TypeScript conventions, security, architecture, patterns, simplicity) that complements your manual analysis from Step 2.

**Incorporate the sub-agent findings into your review in Step 4.** Deduplicate findings — if you and a sub-agent found the same issue, keep the more detailed version.

### 3. Run the security-review skill

Always apply the `security-review` skill as part of every PR/MR review. Work through its checklist and include findings in the review. If no security issues are found, note that explicitly.

### 4. Post the review

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

### 5. Report back to Slack

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

## Repo-specific review checklist

### `decentraland/unity-explorer`

When reviewing PRs in unity-explorer, also check:

- **Naming** — PascalCase for types/methods/properties, camelCase for locals/params, `I` prefix for interfaces, `Async` suffix for async methods
- **No LINQ in hot paths** — Use loops for performance-critical code; LINQ allocates
- **Memory** — Prefer structs, object pooling, `IReadOnlyCollection` for public APIs, no boxing, `StringBuilder` over string concat, static lambdas to avoid closures
- **ECS patterns** — Proper component cleanup on removal/entity destroy/world dispose; structural changes must happen last in queries (refs invalidated by archetype moves); systems must be allocation-free in Update
- **Async** — `SuppressToResultAsync` for detached UniTask flows; prefer `IsCancellationRequested` over `ThrowIfCancellationRequested`; `SafeCancelAndDispose()` for CancellationTokenSource
- **Logging** — Uses `ReportHub` (not `Debug.Log`); verify correct `ReportCategory`
- **Tests** — AAA pattern, NUnit + NSubstitute, `UnitySystemTestBase` for ECS system tests

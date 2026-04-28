---
name: pr-review
description: Review, audit, or summarize a GitHub pull request — fetch the diff, check for bugs/security/test/contract issues, post inline comments or approve/request-changes via `gh`, and report back to Slack. Use this whenever the user asks to review, look at, check, audit, summarize, "take a pass at", or give feedback on a PR (or shares a github.com/.../pull/<n> URL) — even if they don't use the word "review" explicitly.
---

# Pull Request Review

## Triage first

Before doing anything, decide what the user actually wants. The same PR can warrant very different responses, and getting this wrong wastes time and Slack space.

- **Full review** → user says "review", "audit", "give feedback on", "take a pass at", "look for issues in" → read the code carefully, post inline comments + a verdict on GitHub, summarize for Slack.
- **Summary** → user says "what's in", "summarize", "what does this do", "explain" → read the diff, describe the change in Slack. **Do not** post on GitHub.
- **Status check** → user says "is this ready to merge", "what's blocking", "did CI pass" → check CI + reviews + labels, answer in Slack. Skip the diff read unless mergeability is unclear.

If the user's intent is ambiguous, default to a full review. They invoked a PR-review skill — assume they want the review, not just a description.

## Step 1 — Gather context

```bash
# Core PR data — title, body, state, files, CI rollup
gh pr view {number} -R {owner}/{repo} --json title,body,state,headRefName,baseRefName,headRepository,files,reviews,comments,statusCheckRollup,additions,deletions

# Diff — use --stat first to size it before fetching the full diff
gh pr diff {number} -R {owner}/{repo} --stat
gh pr diff {number} -R {owner}/{repo}

# CI checks (more detail than statusCheckRollup)
gh pr checks {number} -R {owner}/{repo}
```

**Repo-specific review guidelines** — check for a `REVIEW.md` at the root of the *base* repo. If it exists, its instructions take precedence over the generic checklist below (it knows what matters in this codebase; you don't).

```bash
gh api repos/{owner}/{repo}/contents/REVIEW.md --jq '.content' 2>/dev/null | base64 -d
```

A 404 means it doesn't exist — proceed with the defaults. If it does exist, mention in your Slack response that you followed it (so the user knows their conventions were applied).

**Existing comments** — read what others have already said before piling on:

```bash
# Inline (line-level) review comments
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  --jq '.[] | {user: .user.login, path: .path, line: .line, body: .body}'

# Top-level conversation
gh api repos/{owner}/{repo}/issues/{number}/comments \
  --jq '.[] | {user: .user.login, body: .body}'
```

If a reviewer has already flagged what you were going to flag, don't repeat it — either acknowledge it ("agreed with @alice on the null check") or focus on what they missed.

**When to clone the repo to `/tmp/`** — only when the diff alone won't tell you what you need. Cloning is worth it for:
- Tracing call sites of a changed function (does the caller handle the new error?)
- Reading types/schemas referenced but not changed (does the new code match them?)
- Checking for missing test files (the diff won't show files that *should* exist but don't)

For a 50-line diff in a self-contained file, just read the diff. Don't clone reflexively.

## Step 2 — Read the code

Cross-reference whatever `REVIEW.md` said. Then apply the generic checklist — but think of it as prompts to ask, not a list to mechanically tick.

- **Bugs** — logic errors, off-by-one, null/undefined access, race conditions, swapped arguments. The cheapest issues to fix in review and the most expensive in production.
- **Security** — injection (SQL, shell, path), auth/authz bypass, secrets committed, unsafe deserialization, SSRF. If the diff touches anything user-controlled, look hard.
- **Error handling** — unhandled promise rejections, swallowed exceptions, missing fallbacks at network/IO boundaries. *Inside* trusted code, over-defensive error handling is noise — don't ask for it.
- **Tests** — are the new code paths covered? Are edge cases (empty input, error path, concurrent access) tested? A diff that adds logic without tests is suspicious; flag it.
- **API contract** — breaking changes to public signatures, missing input validation at boundaries, wrong HTTP methods/status codes. Breaking changes need a migration note.
- **Performance** — N+1 queries, unbounded loops, missing pagination, allocations in hot paths. Only flag if there's evidence it matters at this scale.
- **Style** — only flag if it hurts readability or correctness. Naming, formatting, "I'd write it differently" — skip these. A bot that nitpicks loses trust fast.

For each issue, anchor to a specific file:line and propose a fix. "This might break" is useless feedback; "Line 42 dereferences `user.id` but `user` can be null when the cache misses — add `if (!user) return null` above" is actionable.

**Large diffs** (>500 changed lines): a thorough line-by-line read is unrealistic. Be honest in the Slack response — say you reviewed N high-risk areas (e.g., the new auth code, the migration, the public API changes) and skimmed the rest. Better that the user knows what you skipped than that you fake confidence.

## Step 3 — Post on GitHub (full reviews only)

Pick a verdict:

```bash
# Approve — only if you'd merge it yourself
gh pr review {number} -R {owner}/{repo} --approve --body "<summary>"

# Request changes — there's at least one issue that should block merge
gh pr review {number} -R {owner}/{repo} --request-changes --body "<summary>"

# Comment — feedback worth recording, but not blocking; or you're not the right approver
gh pr review {number} -R {owner}/{repo} --comment --body "<summary>"
```

For line-level comments, batch them into one review via the API (one batched review > many drive-by comments):

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST --input - <<'EOF'
{
  "event": "COMMENT",
  "body": "Overall summary here.",
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "body": "`user` can be null here when the cache misses — guard with `if (!user) return null` to avoid the TypeError on line 43."
    }
  ]
}
EOF
```

**Tone for inline comments** — these comments are posted as a real GitHub user. Keep them constructive and specific:
- Lead with what's wrong, follow with the fix. ("X breaks when Y. Add Z.")
- No "nit:" pile-ons. If it's truly a nit, leave it out.
- No condescension. Assume the author had reasons; if you don't see them, ask instead of declaring.
- "Consider…" / "Could we…" for genuine suggestions; flat statements for bugs and security issues.

**Don't double-post**: if you already submitted a review on this PR, don't submit another one with overlapping comments unless the user explicitly asks for a re-review.

## Step 4 — Report back to Slack

Use Slack mrkdwn (`*bold*`, `_italic_`, `<url|label>`, ` ``` ` for code blocks).

Structure:

1. **Verdict** — approved / changes requested / comments only / no GitHub action (for summary mode).
2. **Key findings** — top 3–5 issues, severity-ranked. Skip noise.
3. **CI status** — passing / failing / pending. Mention specific failed checks.
4. **Notes** — if you followed `REVIEW.md`, mention it. If the diff was too large for a full read, say so.
5. **Link** — PR URL.

Keep it scannable. The user is in Slack, not GitHub — they want the headline, not a transcript.

## Summary-only mode

When the user asked to summarize, not review:

1. **What changed** — describe the purpose and the actual mechanism, not just a file list. ("Adds Redis-backed rate limiting to the public API; new middleware in `src/limit.ts`, config in `config.yaml`.")
2. **CI status** — passing / failing / pending.
3. **Review status** — approved / changes requested / awaiting review.
4. **Blockers** — failing CI, requested changes, `do not merge` label, merge conflicts.
5. **Ready to merge?** — yes / no / not yet, with one-sentence reasoning.

Don't post anything on GitHub in this mode. Don't volunteer a code review the user didn't ask for.

## Edge cases

- **Forks** — `headRepository` in `gh pr view` may differ from the base. The diff comes from the base PR endpoint regardless, but if you need to clone, clone the head's repo at `headRefName`.
- **Closed/merged PRs** — read-only. Don't post reviews on a merged PR; if the user asks, point out it's already merged and offer a post-mortem summary instead.
- **Draft PRs** — usually skip the formal verdict (don't request-changes on a draft); a `--comment` review is fine if the author asked for early feedback.
- **`gh` 403 / no write access** — you can read but can't post. Tell the user; don't silently produce a review they can't publish.

## Quick reference: other useful gh commands

```bash
# Recent PRs in a repo
gh pr list -R {owner}/{repo} --limit 10 --json number,title,author,state,url

# PRs assigned to / authored by a user
gh pr list -R {owner}/{repo} --author {user} --json number,title,state,url

# Search across many repos
gh search prs --owner {org} --state open --json number,title,repository,url
```

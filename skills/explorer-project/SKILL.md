---
name: explorer-project
description: Deep context for the Decentraland Unity Explorer (decentraland/unity-explorer) — labels, issue templates, incident management, severity, and conventions.
---

# Decentraland Unity Explorer — `decentraland/unity-explorer`

Unity-based Decentraland desktop Explorer client.

## GitHub Labels

### Type
| Label | When to use |
|-------|-------------|
| `bug` | Something is broken or not working as expected |
| `enhancement` | Enhancement of an existing feature |
| `feature` | A new feature |
| `suggestion` | A suggested change or feature request that hasn't been reviewed |
| `tech debt` | Code quality or maintenance work |
| `refactor` | Refactoring of a system |
| `optimization` | Something isn't optimal and needs optimization |
| `documentation` | Documentation improvements or additions |

### Severity
| Label | SEV | When to use |
|-------|-----|-------------|
| `0-critical` | SEV-1 | Core platform broken for most users. No workaround. |
| `1-high` | SEV-2 | A primary feature is broken for some users. Platform still partially works. |
| `2-medium` | SEV-3 | A secondary feature is degraded. Main flows still work. |
| `3-low` | SEV-4/5 | Minor issue or cosmetic only. SEV-4 if minor functional impact, SEV-5 if purely visual/copy. |

### Priority
| Label | When to use |
|-------|-------------|
| `release blocker` | Must be fixed before the next platform release can go live |
| `event critical` | Must be fixed before a specific live event or partnership |

### Platform
| Label | When to use |
|-------|-------------|
| `Mac Only` | Issue only happens on Mac builds |
| `Windows Only` | Issue only happens on Windows builds |

### Workflow
| Label | When to use |
|-------|-------------|
| `new` | Issues to triage |
| `need QA validation` | Needs QA verification |
| `no QA needed` | Pull requests that do not require QA validation |
| `no review` | No review is needed |
| `do not merge` | PR is not ready to merge |
| `shape-up` | Has been shaped and is awaiting the cycle |
| `stale` | Inactive issue |
| `duplicate` | Issue has been automatically marked as a duplicate |
| `won't fix` | Will not be worked on |

### Team / Source
| Label | When to use |
|-------|-------------|
| `content-team` | Issues assigned for content team |
| `creator-issue` | Issues that come from a creator |
| `qa-team` | Issues created and validated by the QA team |
| `support` | Issue received by the Support team |
| `sentry` | Issues exclusively opened by Sentry |
| `ReportBot` | Issues opened by ReportBot |

### CI / Build
| Label | When to use |
|-------|-------------|
| `ai-review` | Triggers Claude-AI automatic review |
| `auto-pr` | Auto-generated PR |
| `automation-tests` | Creates an Alttester instrumented build and runs tests |
| `clean-build` | Triggers clean build on PR |
| `force-build` | Triggers a build on draft PR |
| `perf_test` | Run Performance Tests from the PR |

### Other
| Label | When to use |
|-------|-------------|
| `release` | Release-related |
| `ft` | Internal tag |
| `Epic` | Epic-level tracking issue |

## Label Selection Guidance

**Common combinations:**
- Crash/broken feature: `bug` + severity (`0-critical`, `1-high`, etc.) + platform if relevant (`Mac Only`, `Windows Only`)
- New feature request: `feature` or `suggestion`
- Performance problem: `bug` + `performance` + severity
- Visual/rendering glitch: `bug` + `graphics` + severity
- Memory issue: `bug` + `memory-issue` + severity

**Rules of thumb:**
- Always add a type label (`bug`, `enhancement`, `feature`, etc.)
- Add a severity label to bugs (`0-critical`, `1-high`, `2-medium`, `3-low`)
- Add a platform label when the issue is platform-specific
- Add `claw-created` to all issues created by this bot

## Bug Report Template

When creating bug issues in `decentraland/unity-explorer`, format the issue body using these sections. Always include the `bug`, `new`, `need QA validation`, and `qa-team` labels.

```markdown
### Build version
<!-- e.g. 1.2.3, or "Not specified" -->

### Issue Description
<!-- Clear summary of what's broken -->

### STR (Steps to Reproduce)
1. Step one
2. Step two
3. Step three

### Expected Result
<!-- What should happen -->

### Actual Result with evidence
<!-- What actually happened. Include screenshots/logs if available -->

### Reproduction
<!-- Always / Intermittent / Unknown -->

### Operative system and additional Notes
<!-- e.g. Windows 11, macOS Sonoma (M1 vs Intel), etc. -->
```

## Feature Request Template

When creating feature request issues in `decentraland/unity-explorer`, format the issue body using these sections. Always include the `suggestion` label.

```markdown
### Is your feature request related to a problem? Please describe.
<!-- Clear description of the problem. e.g. "I'm always frustrated when..." -->

### Describe the solution you'd like
<!-- Clear description of what you want to happen -->

### Describe alternatives you've considered
<!-- Alternative solutions or features you've considered -->

### Additional context
<!-- Any other context or screenshots -->
```

## Tech Debt Template

When creating tech debt issues in `decentraland/unity-explorer`, format the issue body using these sections. Always include the `tech debt` label.

```markdown
### Priority
<!-- Low / Medium / High / Critical -->

### Area/Component
<!-- Which part of the codebase -->

### Description
<!-- What is the technical debt -->

### Current State
<!-- How is it implemented now and why is it problematic -->

### Proposed Solution
<!-- How should it be fixed -->

### Impact Assessment
<!-- Performance, maintainability, refactoring risks -->

### Effort Estimate
<!-- XS / S / M / L / XL -->

### Dependencies
<!-- Related issues or prerequisites -->

### Additional Notes
<!-- Environment-specific details -->
```

## Incident Management

For severity classification, escalation, hotfix policy, and the full incident process, refer to the **incident** skill. It applies globally across all Decentraland projects.

Explorer-specific escalation handle: **@explorer-support** (client crashes, rendering issues, login failures, teleport, avatar sync, voice chat, launcher).

## Architecture

### Directory Structure

```
Explorer/
  Assets/
    DCL/                          # Main Decentraland source
      Scripts/
        ECS/                      # Entity Component System core
        SceneRuntime/             # JavaScript V8 scene execution
        PluginSystem/             # Plugin architecture (global + world plugins)
        MVC/                      # UI controllers, views, window stack
        AvatarSystem/             # Avatar rendering, wearables, emotes
        Comms/                    # LiveKit comms, voice chat, messaging
        Chat/                     # Chat system (MVP pattern, commands, translation)
        MapRenderer/              # Minimap and world map
        Social/                   # Friends, communities, profiles
        Diagnostics/              # ReportHub logging, Sentry integration
        Settings/                 # Application settings
        WebRequests/              # HTTP request framework
      Plugins/                    # Feature plugins (global + world scope)
      UI/                         # UI prefabs and views
      Shaders/                    # Custom shaders (DCL_Toon, avatar, etc.)
    Tests/                        # EditMode and PlayMode tests
```

### Key Systems

- **ECS** — Custom Entity Component System with source-generated queries, system groups, and component lifecycle (add/remove/destroy/dispose cleanup)
- **Plugin Architecture** — IDCLGlobalPlugin (app-scoped) and IDCLWorldPlugin (scene-scoped) with settings via Addressables
- **Scene Runtime** — ClearScript V8 engine running SDK7 JavaScript scenes in separate threads, synced via CRDT protocol
- **MVC/UI** — ControllerBase pattern with WindowStackManager (Persistent, Fullscreen, Popup, Overlay layers)
- **Avatar Pipeline** — GPU skinning via compute shaders, Global Vertex Buffer, wearable loading, material pooling (DCL_Toon shader)
- **Comms** — Dual-room architecture (RoomHub with Island, Scene, Chat, VoiceChat rooms), movement interpolation
- **Asset Loading** — AssetPromise lifecycle with memory budgeting, cache dereferencing, Addressables integration
- **Diagnostics** — ReportHub with ReportCategory, CategorySeverityMatrix, Sentry handler, per-minute exception tolerance

### Conventions

- **C#** — PascalCase for types/methods/properties, camelCase for locals/params, `I` prefix for interfaces, `Async` suffix for async methods
- **Formatting** — 4-space indent, Allman braces, prefer `var` for obvious types
- **Memory** — Object pooling, `IReadOnlyCollection` for public APIs, `Span<T>`/`Memory<T>`, no boxing, `StringBuilder`, static lambdas, prefer structs
- **No LINQ in hot paths** — Use loops for performance-critical code
- **Tests** — NUnit + NSubstitute, AAA pattern, `UnitySystemTestBase` for ECS tests
- **PR standards** — Branch naming: `feat/`, `fix/`, `chore/`; squash merge

## PR & Branch Workflow

### Branch Model

- **`dev`** — working branch, all PRs target here
- **`main`** — release branch, receives merges from release branches
- **Release branches** — created via workflow: `release/YYYY-MM-DD` from `dev`, PR into `main`
- **Sync** — after a release merges to `main`, an auto-PR syncs `main` back to `dev` (`chore/sync` branch, labeled `auto-pr`)

### PR Title

PRs targeting `dev` must follow **conventional commit** format:
- `feat: add new backpack UI`
- `fix: avatar not rendering on Mac`
- `chore: update dependencies`

CI validates the title and will block merge if it doesn't conform.

### PR Template

PRs must follow the repo's PR template (`.github/PULL_REQUEST_TEMPLATE.md`):

**What does this PR change?**
- What you're changing and why (describe the problem being solved)
- Which issue this addresses (`#123` format)
- For optimizations: performance comparisons (before vs. after)
- For SDK features: include or link to a test scene
- Links to relevant docs, architecture diagrams, Figma designs, screenshots

**Test Instructions**
- **Prerequisites** — checklist of required setup steps and environment/config requirements
- **Test Steps** — numbered steps with expected results after each step
- **Additional Testing Notes** — edge cases to verify, areas needing careful testing, known limitations

QA team members may not have the same technical context — be explicit about requirements and expected outcomes.

**Quality Checklist**
- [ ] Changes have been tested locally
- [ ] Documentation has been updated (if required)
- [ ] Performance impact has been considered
- [ ] For SDK features: Test scene is included

### Approval Requirements

- **1 DEV approval** (from `explorer-devs` team) — always required
- **1 QA approval** (from `qa` team) — required unless `no QA needed` label is present
- Both skipped entirely for PRs labeled `auto-pr`
- Reviewers with pending re-review requests don't count as approved

### Label-Driven CI Behavior

| Label | Effect |
|-------|--------|
| `perf_test` | Triggers performance tests, skips regular tests, **blocks merge** (remove label to unblock) |
| `force-build` | Runs tests even on draft PRs |
| `clean-build` | Triggers a clean build (no cache) on the PR |
| `automation-tests` | Creates an Alttester instrumented build and runs automated tests |
| `no QA needed` | Makes QA approval optional |
| `no review` | Skips Claude AI review and auto-assign |
| `auto-pr` | Skips approval enforcement and Claude review (used by sync/release workflows) |
| `ai-review` | Triggers Claude AI automatic review |

### Claude AI Review

Every PR gets a pending "Claude Review" status check. Trigger it by commenting `@claude review` on the PR. Claude analyzes code quality, bugs, security, performance, and error handling, then sets the status to pass/fail. Skipped for PRs labeled `no review` or `auto-pr`.

## Ticket Status Check

When asked about the status of a ticket (issue), follow these steps to give a complete picture: is it closed, is it merged to dev, and which release includes it.

### Step 1 — Get issue state

```bash
gh issue view {number} -R decentraland/unity-explorer --json state,title,stateReason,closedAt,labels,assignees
```

- If the issue has the **`new`** label → it has **not been triaged** by the engineering team yet. Report this.
- If the issue has **assignees** → it is actively being worked on (or will be soon). Include who is assigned.
- If **open** and no assignees → report "open, not yet assigned".
- If **closed** → continue to Step 2.

### Step 2 — Find the closing PR and check if merged to dev

Search for the PR that closed/fixed this issue:

```bash
# Search for PRs that reference the issue number
gh pr list -R decentraland/unity-explorer --search "{number}" --state merged --json number,title,headRefName,baseRefName,mergedAt,url --limit 10
```

Look for a PR whose title or body references `#{number}` and whose `baseRefName` is `dev`. If found, report it as merged to dev with the merge date.

If no PR is found via search, check the issue timeline for closing events:

```bash
gh api repos/decentraland/unity-explorer/issues/{number}/timeline --jq '[.[] | select(.event == "closed" or .event == "cross-referenced") | {event, source: .source.issue.number, commit_id}]'
```

### Step 3 — Identify which release includes it

Releases follow a weekly cadence (typically Tuesday/Wednesday). A release branch (`release/YYYY-MM-DD`) is cut from `dev` and a PR is opened targeting `main`. Once merged and tagged, it becomes a GitHub Release.

#### 3a — Check published GitHub Releases

```bash
gh release list -R decentraland/unity-explorer --limit 10 --json tagName,name,publishedAt
```

For each recent release tag, check if the PR's merge commit is an ancestor:

```bash
# Check if the merge commit is included in a release tag
git log {release_tag} --oneline --grep="#{pr_number}" | head -5
```

Or use the GitHub API to compare:

```bash
gh api repos/decentraland/unity-explorer/compare/{merge_commit_sha}...{release_tag} --jq '.status'
```

If `status` is `"behind"` or `"identical"`, the commit is included in that release.

#### 3b — Check open release PRs (upcoming release)

If the fix is not in any published release, check if there is an open release PR that includes it:

```bash
# Find open release PRs (branch pattern: release/YYYY-MM-DD, targeting main)
gh pr list -R decentraland/unity-explorer --base main --head "release/" --state open --json number,title,headRefName,url

# Check if the PR's merge commit is in the release branch
gh api repos/decentraland/unity-explorer/compare/{merge_commit_sha}...{release_branch} --jq '.status'
```

If included in an open release PR, report it as part of the upcoming release.

#### 3c — Not in any release yet

If the fix is merged to `dev` but not in any release branch, report that it will be included in the next release cycle.

### Output Format

```
🎫 Ticket #{number}: {title}
• State: ✅ Closed / 🔴 Open
• Triage: 🆕 Not yet triaged (has `new` label) / ✅ Triaged
• Assigned: 👤 @developer (actively being worked on) / ⚪ Unassigned
• Merged to dev: ✅ Yes — {PR link} (merged {date}) / ❌ No
• Release: 📦 Included in {version} ({release_date}) / 🚀 In upcoming release {release_branch} / ⏳ Not yet in a release — will be in the next cycle
```

Only include the Triage/Assigned lines for open issues. For closed issues, skip straight to merge and release status.

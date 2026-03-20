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

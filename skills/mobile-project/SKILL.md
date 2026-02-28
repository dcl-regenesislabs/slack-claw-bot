---
name: mobile-project
description: Deep context for the Decentraland mobile client (decentraland/godot-explorer) — labels, architecture, platforms, and conventions.
---

# Decentraland Mobile Client — `decentraland/godot-explorer`

Cross-platform metaverse client combining Godot Engine 4.5.1 (custom fork) + Rust for core systems.

## Platform Targets

- **Android** (API 29+)
- **iOS**
- **Linux** (desktop)
- **Windows** (desktop)
- **macOS** (desktop)
- **VR / Meta Quest** (OpenXR)

## GitHub Labels

### Type
| Label | When to use |
|-------|-------------|
| `bug` | Something is broken or not working as expected |
| `enhancement` | New feature or improvement to existing functionality |
| `question` | Needs clarification or discussion |
| `documentation` | Docs improvements or additions |
| `discussion` | Open-ended topic, no clear action yet |
| `research` | Needs investigation before a solution can be proposed |
| `spike` | Time-boxed exploration of a technical approach |
| `tracking` | Meta-issue that tracks multiple sub-issues |
| `feature parity` | Bringing functionality in line with another client |
| `polish` | Minor visual changes or wording tuning |
| `experimental` | Exploratory work, may not ship |
| `tech debt` | Code quality or maintenance work |

### Platform
| Label | When to use |
|-------|-------------|
| `mobile` | Affects mobile platforms generally |
| `Android` | Android-specific |
| `iOS` | iOS-specific |
| `without-ios` | Intentionally excluded from iOS builds |
| `desktop` | Affects desktop platforms |
| `vr` | VR / Meta Quest specific |

### Severity / Priority
| Label | When to use |
|-------|-------------|
| `blocker` | Blocks a release or other critical work |
| `minor` | Low-impact, cosmetic, or nice-to-have |

### Workflow
| Label | When to use |
|-------|-------------|
| `planning` | WIP — needs further definition or hasn't been estimated |
| `need definition` | Requirements are unclear |
| `needs design` | Requires design input before implementation |
| `need tech test` | Needs technical validation |
| `re-test` | Needs re-testing after a fix |
| `blocked` | Waiting on an external dependency or decision |
| `do not merge` | PR is not ready to merge |
| `sprintfiller` | Can be picked up if there's capacity in the sprint |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention is needed |
| `duplicate` | Already exists |
| `invalid` | Not a valid issue |
| `wontfix` | Will not be worked on |

### Area
| Label | When to use |
|-------|-------------|
| `performance` | Performance-related (FPS, load times, network) |
| `rendering` | Rendering, shaders, visual glitches |
| `memory optimization` | Memory usage, leaks, allocation |
| `metrics` | Analytics, telemetry, tracking events |
| `dependencies` | Dependency updates (usually automated PRs) |
| `rust` | Rust code changes |

### CI / Build
| Label | When to use |
|-------|-------------|
| `build-ios` | Triggers iOS CI build on a PR |
| `publish-docker` | Triggers Docker image publish |

### Other
| Label | When to use |
|-------|-------------|
| `foundation-ask` | Request originating from the Decentraland Foundation |
| `plaza` | Related to Genesis Plaza (main gathering area) |
| `claw-created` | Issue was created by the Claw bot (this bot) |
| `commtesting` | Community testing |

## Label Selection Guidance

**Common combinations:**
- Crash/broken feature: `bug` + platform (`Android`, `iOS`, `desktop`, `vr`) + `blocker` if severe
- New feature request: `enhancement` + platform if relevant
- Performance problem: `bug` + `performance` + platform
- Visual glitch: `bug` + `rendering` + platform
- Memory leak: `bug` + `memory optimization` + platform

**Rules of thumb:**
- Always add a type label (`bug`, `enhancement`, `question`, etc.)
- Add a platform label when the issue is platform-specific or was reported on a specific platform
- Use `blocker` sparingly — only for things that block a release
- Use `planning` or `need definition` when requirements are vague
- Add `claw-created` to all issues created by this bot

## Architecture

### Directory Structure

```
lib/                     # Core Rust library
  src/
    dcl/                 # Decentraland SDK bindings, scene runner (JavaScript/V8)
    av/                  # Audio/video processing, video player
    comms/               # WebRTC, voice chat (livekit)
    avatars/             # Avatar system — wearables, animations, GLTF models
    content/             # Asset loading, caching, IPFS content servers
    auth/                # Authentication
    profile/             # User profiles
    realm/               # Realm/server selection and switching
    social/              # Social features (friends, chat)
    scene_runner/        # Scene lifecycle management
    analytics/           # Analytics events
    asset_server/        # Local asset serving
    http_request/        # HTTP client utilities
    notifications/       # Notification system
    godot_classes/       # GDExtension Rust↔Godot bindings
    tools/               # Dev tooling
    urls/                # URL routing and deeplinks
    utils/               # Shared utilities
    env/                 # Environment configuration

godot/                   # Godot project
  src/                   # GDScript game logic
    decentraland_components/  # Custom Godot nodes for DCL features
    ui/                  # UI components and HUD
    tool/                # Editor tools
  shaders/               # Custom shaders
  addons/                # Godot plugins
  ios/                   # iOS-specific config

src/                     # xtask build system (Rust CLI for building/running/exporting)

scripts/                 # Test scripts (Python)
tests/                   # Test fixtures
docs/                    # Documentation
plugins/                 # Native plugins
```

### Key Systems

- **Scene Management** — JavaScript runtime (deno_core/V8) executes Decentraland SDK7 scenes
- **Avatar System** — Wearables loaded as GLTF, animations via Godot AnimationPlayer
- **Content Delivery** — IPFS + content servers for asset distribution and caching
- **Voice Chat** — LiveKit WebRTC for spatial audio
- **Comms** — Real-time communication between clients

## Conventions

- **Rust 1.90** (pinned in `rust-toolchain.toml`)
- **Godot 4.5.1** custom fork — do not update engine version
- **Build system** — xtask pattern: all commands via `cargo run -- <command>`
- **Formatting** — `cargo fmt --all` for Rust, `gdformat` for GDScript
- **Linting** — `cargo clippy -- -D warnings` for Rust, `gdlint` for GDScript

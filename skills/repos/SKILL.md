---
name: repos
description: Repository aliases, dependencies, and cross-repo relationships. Consult this skill to understand which repos exist, how they relate to each other, and where fixes should be applied — especially when an issue is filed in one repo but the fix belongs in another.
---

# Repository Aliases

| Alias | Repository | Description |
|-------|-----------|-------------|
| explorer | decentraland/unity-explorer | Unity desktop Explorer client |
| bevy | decentraland/bevy-explorer | Bevy-based explorer client |
| mobile | decentraland/godot-explorer | Godot mobile explorer |
| creator-hub | decentraland/creator-hub | Creator Hub monorepo (includes inspector, asset packs) |
| sdk | decentraland/js-sdk-toolchain | SDK toolchain: ECS, CLI, @dcl/* packages |
| towerofmadness | dcl-regenesislabs/towerofmadness | Tower of Madness game |

When a user mentions one of these aliases, use the corresponding `owner/repo` for `gh` CLI commands.

Users can also reference any public repo directly by its `owner/repo` name.

## Archived Repositories

The following repositories are **ARCHIVED** and should NEVER be used for fixes:

| Archived repo | Fix belongs in |
|---|---|
| `decentraland/asset-packs` | `decentraland/creator-hub` (asset-packs package inside the monorepo) |

---

## Repository Dependencies

**This is the dependency graph between major repositories.** Use it to trace where bugs originate and where fixes should be applied.

| Repository | Depends on | What it consumes |
|---|---|---|
| `decentraland/creator-hub` | `decentraland/js-sdk-toolchain` | `@dcl/sdk`, `@dcl/ecs`, `@dcl/sdk-commands`, `@dcl/inspector`, CLI tooling |
| `decentraland/creator-hub` | (internal packages) | Asset packs, scene templates, inspector UI |
| `decentraland/godot-explorer` | (self-contained) | Rust `lib/` (core systems) + Godot `godot/` (UI, scripts) |
| `decentraland/unity-explorer` | (self-contained) | Unity/C# desktop Explorer client (ECS, plugins, ClearScript V8 scene runtime) |
| `decentraland/bevy-explorer` | (self-contained) | Bevy-based explorer, Rust only |

### Key packages and where they live

| Package / import | Source repo | Notes |
|---|---|---|
| `@dcl/sdk` | `decentraland/js-sdk-toolchain` | Scene SDK |
| `@dcl/ecs` | `decentraland/js-sdk-toolchain` | Entity Component System |
| `@dcl/sdk-commands` | `decentraland/js-sdk-toolchain` | CLI commands (deploy, preview, etc.) |
| `@dcl/inspector` | `decentraland/js-sdk-toolchain` | Scene inspector core |
| `@dcl/react-ecs` | `decentraland/js-sdk-toolchain` | React bindings for ECS |
| Asset packs (models, textures, thumbnails) | `decentraland/creator-hub` | Internal monorepo package |


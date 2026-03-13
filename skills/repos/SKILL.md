---
name: repos
description: Aliases for commonly used repositories. The agent can interact with any public GitHub repo, but these aliases provide shortcuts.
---

# Repository Aliases

| Alias | Repository | Description |
|-------|-----------|-------------|
| bevy | decentraland/bevy-explorer | Bevy-based explorer client |
| mobile | decentraland/godot-explorer | Godot mobile explorer |
| creator-hub | decentraland/creator-hub | Creator Hub monorepo (includes inspector, assets packs) |
| towerofmadness | dcl-regenesislabs/towerofmadness | Tower of Madness game |

When a user mentions one of these aliases, use the corresponding `owner/repo` for `gh` CLI commands.

Users can also reference any public repo directly by its `owner/repo` name.

## Important Notes

### Creator Hub Monorepo

The `decentraland/creator-hub` repository is now a **monorepo** that includes:
- Main Creator Hub application
- Scene Inspector
- Assets Packs

**All issues related to inspector and assets packs should be created in the creator-hub repository**, not in separate repos.

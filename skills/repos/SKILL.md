---
name: repos
description: Aliases for commonly used repositories. The agent can interact with any public GitHub repo, but these aliases provide shortcuts.
---

# Repository Aliases

| Alias | Repository | Description |
|-------|-----------|-------------|
| bevy | decentraland/bevy-explorer | Bevy-based explorer client |
| mobile | decentraland/godot-explorer | Godot mobile explorer |
| towerofmadness | dcl-regenesislabs/towerofmadness | Tower of Madness game |

When a user mentions one of these aliases, use the corresponding `owner/repo` for `gh` CLI commands.

Users can also reference any public repo directly by its `owner/repo` name.

## Channel defaults

The prompt includes a `Channel: #name` line identifying the Slack channel the message came from. When an action needs a repo (e.g. creating an issue) and **no repo is explicitly named in the conversation**, default to the channel's repo below:

| Channel | Default repo |
|---------|-------------|
| #mobile-support | decentraland/godot-explorer |
| #project-bevy-explorer | decentraland/bevy-explorer |
| #bevy-support | decentraland/bevy-explorer |

Rules:
- If the conversation explicitly names a repo or alias, that always wins over the channel default.
- If no repo is named and the channel has a default, use it. **Never guess a repo.**
- If no repo is named and the channel has no default here, ask the user which repo to use instead of guessing.

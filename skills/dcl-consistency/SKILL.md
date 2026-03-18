---
name: dcl-consistency
description: Check Decentraland Catalyst consistency for pointers and wearables. Activated when the prompt asks to check pointer consistency, check pointers, check wearables consistency, or check asset bundles.
---

# Decentraland Consistency Checks

Run `@dcl/opscli` via `npx` and relay the output. No authentication required.

## Commands

| Prompt | CLI command |
|---|---|
| `check pointer consistency: <pointer>` | `npx --yes @dcl/opscli pointer-consistency --pointer "<pointer>"` |
| `check wearables consistency: <address>` | `npx --yes @dcl/opscli wearables-consistency --address "<address>"` |

## Workflow

1. Run the appropriate `npx --yes @dcl/opscli` command
2. Relay the output as-is in a code block
3. Add a one-line summary: whether the result is convergent/consistent, and the propagation time if applicable

## Rules

- Always use `npx --yes @dcl/opscli` to skip the install prompt
- Do not make any additional HTTP calls — opscli handles everything
- If the command fails, show the error output and suggest checking the pointer/address format

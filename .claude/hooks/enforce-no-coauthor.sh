#!/bin/bash
# Blocks `git commit` commands whose message contains a Co-Authored-By trailer.
# Project convention forbids AI attribution in commits; the default Claude Code
# prompt instructs Claude to add one, so this guard enforces the rule at the
# harness level.

set -u

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')

case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

if printf '%s' "$CMD" | grep -qiE 'co-authored-by:'; then
  REASON="BLOCKED by .claude/hooks/enforce-no-coauthor.sh: the commit message contains a 'Co-Authored-By:' trailer. Project convention forbids AI attribution in commits. Remove the line and retry."
  jq -n --arg reason "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

exit 0

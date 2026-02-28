---
name: triage
description: Triage and label GitHub issues based on content analysis.
---

# Issue Triage

Analyze the issue content and apply appropriate labels. For repo-specific label lists (e.g. `decentraland/godot-explorer`), refer to the mobile-project skill.

## General Labels

- **bug** — something is broken or not working as expected
- **feature** — a new capability or enhancement request
- **question** — needs clarification or discussion
- **documentation** — documentation improvements or additions
- **performance** — performance-related concerns
- **security** — security-related issues

## Severity

- **critical** — system down, data loss, security vulnerability
- **high** — major feature broken, significant user impact
- **medium** — feature partially broken, workaround exists
- **low** — minor issue, cosmetic, nice-to-have

## Applying Labels

Prefer setting labels at creation time when possible:
```bash
gh issue create --repo {repo} --title "..." --body "..." --label "bug,high"
```

To label existing issues:
```bash
gh issue edit {number} --repo {repo} --add-label "bug,high"
```

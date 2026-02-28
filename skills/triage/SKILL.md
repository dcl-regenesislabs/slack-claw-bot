---
name: triage
description: Triage and label GitHub issues based on content analysis.
---

# Issue Triage

When triaging issues, consider:

## Labels to Apply

- **bug** — something is broken or not working as expected
- **feature** — a new capability or enhancement request
- **question** — a question or discussion that needs clarification
- **documentation** — documentation improvements or additions
- **performance** — performance-related concerns
- **security** — security-related issues

## Severity Assessment

- **critical** — system down, data loss, security vulnerability
- **high** — major feature broken, significant user impact
- **medium** — feature partially broken, workaround exists
- **low** — minor issue, cosmetic, nice-to-have

## Adding Labels

```
gh issue edit {number} --repo {repo} --add-label "bug,high"
```

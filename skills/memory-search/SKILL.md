---
name: memory-search
description: Search older daily logs and memory files for past context
---

# Memory Search

Use this skill when you need context from past runs beyond today.

## How to search

Use `qmd` to search across shared memory files (daily logs, shared knowledge). The search index covers `shared/` only — user-specific files under `users/` are not indexed. The index name and memory base directory are provided in your context.

### Quick keyword search

```bash
npx qmd --index claw-memory search "PR review" -n 5
```

### Full document output

```bash
npx qmd --index claw-memory search "deployment" --full
```

### Direct file access

You can also read files directly using the memory base directory from context:

```bash
# Read a specific day
cat <memory_base_dir>/shared/daily/2026-03-01.md

# List recent daily logs
ls -t <memory_base_dir>/shared/daily/ | head -7
```

## When to use

- User asks "remember when..." or "last time you..."
- You need context about a repo or workflow you've seen before
- You want to check if you've encountered an error before

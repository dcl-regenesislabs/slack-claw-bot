---
name: dependency-management
description: Decentraland dependency management standard for JavaScript/TypeScript projects. Covers when to use dependencies, peerDependencies, peerDependenciesMeta, and devDependencies. Use during PR reviews to validate correct dependency placement, version pinning, and singleton safety.
---

# Dependency Management Standard

Source: https://docs.decentraland.org/contributor/contributor-guides/dependency-management

This document defines the recommended practices for managing dependencies in JavaScript/TypeScript projects across Decentraland's ecosystem. It applies to front-end, back-end, SDKs, shared libraries, and any npm/yarn/pnpm-based package.

> **TL;DR**:
> - **Version strategy** → Use **exact/fixed versions** for `dependencies` (security) and `devDependencies` (consistent dev environment). Use **version ranges** only for `peerDependencies` (flexibility).
> - **Exception** → Decentraland packages (`@dcl/*`, `decentraland-*`) can use version ranges (`^`) as they are trusted internal packages.
> - **Libraries/shared packages** → Use `peerDependencies` with version ranges (`^`) for shared libraries (React, `@dcl/schemas`, etc.). Use `dependencies` with exact versions only for utilities safe to duplicate.
> - **Apps/final services** → Use `dependencies` with exact versions for runtime packages (React, ethers, etc.).

## 1. Rationale

Many libraries rely on global singletons, React Context, class identity, shared caches, schema enums, or shared DB pools. Installing multiple versions of the same library can cause:
- Context not shared between copies
- Duplicate caches or pools
- Failing `instanceof` checks
- Enum/symbol mismatches
- Increased bundle size
- Hard-to-diagnose runtime bugs

Correct dependency management prevents these issues.

### Non-goals

This standard does **not** attempt to:
- Enforce a single package manager (npm, yarn, pnpm are all supported)
- Guarantee a single physical copy in `node_modules` (focus is on runtime/bundle deduplication)

## 2. Definitions

| Field | Purpose | Consumer responsibility | Applies to |
|-------|---------|------------------------|------------|
| `dependencies` | Packages used internally by the module | None — consumer is not expected to provide them | Apps and libraries |
| `peerDependencies` | Packages that must resolve to a single effective version at runtime | Must install them (or use `peerDependenciesMeta` for optional) | **Libraries only** |
| `peerDependenciesMeta` | Metadata for `peerDependencies`, used to mark peers as optional | None — only affects package manager behavior | **Libraries only** |
| `devDependencies` | Tooling only used during development | None | Apps and libraries |

### About peerDependenciesMeta

`peerDependenciesMeta` provides metadata about your `peerDependencies`. The most common use case is marking peers as **optional**:

- **Required peers** (default): Package manager will warn if not installed
- **Optional peers**: Package manager won't warn if missing; your package should handle their absence gracefully

Use cases:
- Packages that work in both React and non-React environments
- Libraries that support multiple Web3 providers (ethers, viem, etc.)
- Utilities that enhance other libraries but aren't required

### Apps vs Libraries

**Libraries / Shared Packages:**
- Use `peerDependencies` for packages that must resolve to a single effective version at runtime (React, ethers, `@dcl/schemas`)
- Consumer (app) provides these dependencies
- Prevents duplicate installations and singleton conflicts

**Apps / Final Services:**
- Use `dependencies` for runtime packages (React, ethers, etc.)
- They are the final consumer, so duplication is not a concern
- `peerDependencies` still valid if the app might be consumed as a dependency

## 3. When to Use Each Field

### Use `peerDependencies` for (Libraries only):

Packages that must resolve to a single effective version at runtime:
- React, Redux, wagmi, ethers, viem
- `@dcl/schemas` and similar cross-ecosystem libraries
- `decentraland-connect`
- DB drivers when sharing pools
- Any library relying on singletons or context

✅ Correct (Library):
```json
{
  "peerDependencies": {
    "react": "^18.0.0",
    "@dcl/schemas": "^20.0.0"
  }
}
```

❌ Incorrect (Library using dependencies for shared libs):
```json
{
  "dependencies": {
    "react": "^18.0.0"
  }
}
```

### Use `dependencies` for:
- Utilities safe to duplicate (`lodash-es`, `date-fns`)
- **In apps**: Runtime packages like React, ethers (when app is final consumer)

> **Important**: Always use **exact/fixed versions** in `dependencies` for security.

✅ Correct (Library):
```json
{
  "dependencies": {
    "lodash-es": "4.17.21",
    "date-fns": "3.6.0"
  }
}
```

✅ Correct (App):
```json
{
  "dependencies": {
    "react": "18.3.1",
    "ethers": "6.13.0",
    "lodash-es": "4.17.21"
  }
}
```

### Optional peerDependencies (`peerDependenciesMeta`)

For reusable packages that work with or without certain dependencies:

✅ Correct:
```json
{
  "peerDependencies": {
    "react": "^18.0.0",
    "ethers": "^6.0.0"
  },
  "peerDependenciesMeta": {
    "ethers": {
      "optional": true
    }
  }
}
```

### Use `devDependencies` for:
- Tooling (TypeScript, ESLint, testers, bundlers)

> **Important**: Always use **exact/fixed versions** in `devDependencies` to ensure a consistent development environment across the team.

✅ Correct:
```json
{
  "devDependencies": {
    "typescript": "5.4.5",
    "eslint": "8.57.0",
    "vitest": "1.6.0"
  }
}
```

## 4. Common Packages Reference

### Packages that MUST be `peerDependencies` (shared context / singletons)

- `react`, `react-dom`, `react-redux`, `react-router-dom`
- `redux`, `@reduxjs/toolkit`
- `ethers`, `viem`, `wagmi`
- `@dcl/schemas`, `@dcl/ui-env`, `@dcl/crypto`
- `decentraland-dapps`, `decentraland-ui`, `decentraland-ui2`, `decentraland-connect`
- `pg`, `pg-pool`

### Packages that SHOULD be `dependencies` (safe to duplicate)

- `lodash-es`, `date-fns`
- `uuid`, `nanoid`
- `zod`, `ajv`
- `ms`, `mitt`, `fp-future`

## 5. PR Review Checklist

When reviewing a PR that modifies `package.json`, verify:

1. **Libraries**: Shared/singleton packages (React, ethers, `@dcl/*`) are in `peerDependencies` with `^` ranges
2. **Apps**: Runtime packages are in `dependencies` with exact versions (no `^` or `~`)
3. **Both**: `devDependencies` use exact versions
4. **Exception**: `@dcl/*` and `decentraland-*` packages may use `^` ranges in `dependencies`
5. **No missing peers**: If a library uses React/ethers/etc. internally, they must be declared as `peerDependencies`
6. **Optional peers**: If a peer is optional, it should be marked in `peerDependenciesMeta`

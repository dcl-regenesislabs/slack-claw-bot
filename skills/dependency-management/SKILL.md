---
name: dependency-management
description: Decentraland dependency management standard for JavaScript/TypeScript projects. Covers when to use dependencies, peerDependencies, peerDependenciesMeta, and devDependencies. Use during PR reviews to validate correct dependency placement, version pinning, and singleton safety.
---

# Dependency Management Standard

Adapted from: https://docs.decentraland.org/contributor/contributor-guides/dependency-management

> **Note — canonical source**: The [docs site](https://docs.decentraland.org/contributor/contributor-guides/dependency-management) is the canonical reference. This skill is a derived copy optimised for agent consumption. If the two diverge, the docs site wins. When reviewing, check the source URL is still live; if it 404s, flag it to the team.

This document defines the recommended practices for managing dependencies in JavaScript/TypeScript projects across Decentraland's ecosystem. It applies to front-end, back-end, SDKs, shared libraries, and any npm/yarn/pnpm-based package.

> **TL;DR**:
> - **Version strategy** → Use **exact/fixed versions** for `dependencies` and `devDependencies`. Use **version ranges** (`^`) only for `peerDependencies`.
> - **Decentraland exception** → `@dcl/*` and `decentraland-*` packages may use `^` ranges in `dependencies` (not just `peerDependencies`). This is safe because internal packages follow a disciplined release process with semantic versioning, coordinated across the monorepo/org — so a minor/patch bump is unlikely to introduce breaking changes the way an external package might.
> - **`@dcl/*` as peer vs dependency** → The exception above applies *only in apps*. In *libraries*, `@dcl/*` packages that are shared-context or singletons (e.g. `@dcl/schemas`, `@dcl/ui-env`, `@dcl/crypto`) still *must* be `peerDependencies` — the app-vs-library rule takes precedence. The `^`-range exception means that when an app lists `@dcl/schemas` in `dependencies`, it may use `"^25.0.0"` instead of `"25.3.0"`.
> - **Libraries/shared packages** → Use `peerDependencies` with version ranges (`^`) for shared libraries (React, `@dcl/schemas`, etc.). Use `dependencies` with exact versions only for utilities safe to duplicate.
> - **Apps/final services** → Use `dependencies` with exact versions (or `^` for `@dcl/*`/`decentraland-*`) for runtime packages.

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

> **Important**: Always use **exact/fixed versions** in `dependencies` for security. Exception: `@dcl/*` and `decentraland-*` packages may use `^` ranges because internal releases follow strict semver discipline (see TL;DR above).

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

✅ Also correct (App, internal package with `^`):
```json
{
  "dependencies": {
    "@dcl/schemas": "^25.0.0",
    "decentraland-ui2": "^2.0.0"
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

### Packages that MUST be `peerDependencies` in libraries (shared context / singletons)

- `react`, `react-dom`, `react-redux`, `react-router-dom`
- `redux`, `@reduxjs/toolkit`
- `ethers`, `viem`, `wagmi`
- `@dcl/schemas`, `@dcl/ui-env`, `@dcl/crypto`
- `decentraland-dapps`, `decentraland-ui`, `decentraland-ui2`, `decentraland-connect`
- `pg`, `pg-pool`

> In **apps**, these same packages go in `dependencies` with exact versions (or `^` for `@dcl/*`/`decentraland-*`).

### Packages that SHOULD be `dependencies` (safe to duplicate)

- `lodash-es`, `date-fns`
- `uuid`, `nanoid`
- `zod`, `ajv`
- `ms`, `mitt`, `fp-future`

## 5. Automated Lint Rules (npm-package-json-lint)

Decentraland enforces these rules via [`npm-package-json-lint`](https://github.com/decentraland/eslint-config/blob/main/npm-package-json-lint.js). When reviewing PRs, check compliance:

| Rule | Severity | Effect |
|------|----------|--------|
| `prefer-absolute-version-dependencies` | warning | `dependencies` must use exact versions — except `@dcl/*`, `decentraland-*`, and `dcl-*` packages which are auto-exempted |
| `prefer-absolute-version-devDependencies` | warning | `devDependencies` must use exact versions — same internal-package exception |
| `no-file-dependencies` | error | No `file:` protocol references in dependencies |
| `no-git-dependencies` | error | No `git+` / GitHub URL references in dependencies |
| `no-duplicate-properties` | error | No duplicate keys in `package.json` |
| `prefer-property-order` | error | Fields must follow a standard order: `name`, `version`, `description`, `main`, `module`, `types`, `type`, `exports`, `files`, `scripts`, `dependencies`, `peerDependencies`, `peerDependenciesMeta`, `devDependencies`, `repository`, `keywords`, `author`, `license`, `bugs`, `homepage`, `engines`, `overrides`, `publishConfig` |

> The internal-package exception (`@dcl/*`, `decentraland-*`, `dcl-*`) is computed dynamically from the repo's own `package.json` at lint time. If a package name matches one of those prefixes it is excluded from the exact-version rule.

## 6. PR Review Checklist

When reviewing a PR that modifies `package.json`, verify:

1. **Libraries**: Shared/singleton packages (React, ethers, `@dcl/*`) are in `peerDependencies` with `^` ranges
2. **Apps**: Runtime packages are in `dependencies` with exact versions (no `^` or `~`) — except internal `@dcl/*`/`decentraland-*` packages which may use `^`
3. **Both**: `devDependencies` use exact versions (same internal exception applies)
4. **Decentraland exception clarity**: `@dcl/*` and `decentraland-*` packages may use `^` in `dependencies`/`devDependencies` because internal releases follow strict semver discipline and are coordinated across the organisation. This does *not* exempt them from being `peerDependencies` in libraries when they are shared-context packages.
5. **No missing peers**: If a library uses React/ethers/`@dcl/schemas` etc. internally, they must be declared as `peerDependencies`
6. **Optional peers**: If a peer is optional, it should be marked in `peerDependenciesMeta`
7. **No `file:` or `git+` dependencies** (enforced by lint)
8. **Property order**: `package.json` fields should follow the standard order (see Section 5)
9. **No duplicate keys** in `package.json`

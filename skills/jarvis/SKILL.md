---
name: jarvis
description: Resolve Decentraland service architecture from the jarvis manifests — which service owns an endpoint or repo, what it exposes (API, events, entities), and which services depend on it (blast radius). Use whenever a question, PR review, or issue involves Decentraland services, endpoints, or cross-service impact.
---

# Jarvis — Decentraland service manifests

The `decentraland/jarvis` repo ships LLM-optimized YAML snapshots of every Decentraland service. Use them to ground answers about where things live and what breaks downstream. **Never answer Decentraland architecture questions from general knowledge — read the manifests first.**

## Where the manifests live

The bot clones the repo to `/tmp/jarvis` on startup when the grants feature is enabled. Ensure it exists and is fresh:

```bash
if [ -d /tmp/jarvis/.git ]; then
  git -C /tmp/jarvis pull --ff-only --quiet || true
else
  gh repo clone decentraland/jarvis /tmp/jarvis -- --depth 1
fi
```

## Manifests (`/tmp/jarvis/manifests/`)

| File | Purpose | Cost |
|------|---------|------|
| `index.yaml` | One entry per service: name, description, layer, repository, dependencies | ~600 tokens — always start here |
| `graph.yaml` | Full cross-service dependency graph | ~2,500 tokens |
| `{service}.yaml` | Per-service: team, repository, ai-agent-context URL, owned_entities, responsibilities, invariants, openapi_url, DB schema_url, events, ADRs | read only for services you've shortlisted |

## Workflow

1. **Locate**: read `index.yaml` and find the service(s) matching the repo, endpoint, or topic. A repo URL maps to a service via the `repository` field.
2. **Detail**: read the shortlisted `{service}.yaml` — endpoints come from `openapi_url`, plus `owned_entities`, `events`, `invariants`, and the owning `team`.
3. **Blast radius**: read `graph.yaml` and walk **both directions** — what the service depends on AND which services depend on it (the dependents are who breaks when its API changes).
4. **Verify, don't assume**: the graph names candidate consumers; confirm a candidate actually calls the changed surface before claiming breakage — `gh search code --owner decentraland "<route-or-symbol>"` or a shallow clone + `git grep`.

State your source when answering ("per `catalyst.yaml`, …"). If a service or endpoint isn't in the manifests, say so explicitly rather than guessing — the manifests are generated snapshots and can lag reality.

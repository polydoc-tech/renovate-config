# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) preset for all PolyDoc repositories
(core services under `tobias-dev/pdoc-*` and connectors under `polydoc-tech/*-polydoc`).

Each repo's `renovate.json` extends this preset instead of duplicating the policy:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>polydoc-tech/renovate-config"]
}
```

Change the dependency-update policy (schedule, grouping, automerge, digest pinning,
vulnerability handling) here in `default.json` and it applies everywhere.

This repo is public so the preset resolves from private core repos and public
connector repos across both orgs without per-repo access grants.

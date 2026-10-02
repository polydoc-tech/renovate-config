# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) preset for the PolyDoc repositories.

Each repo's `renovate.json` extends this preset instead of duplicating the policy:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>polydoc-tech/renovate-config"]
}
```

Change the dependency-update policy (schedule, grouping, automerge, digest pinning,
vulnerability handling) here in `default.json` and it applies everywhere.

Patches and minors are grouped, majors are not. A major usually needs code changes,
so one branch carrying every pending major is blocked by whichever package is hardest
to migrate, and the combined lockfile churn hides which bump broke the build. Each
major arriving on its own is reviewable and mergeable in isolation.

This repo is public so the preset resolves from private core repos and public
connector repos across both orgs without per-repo access grants.

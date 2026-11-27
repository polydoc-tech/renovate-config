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

## Minimum release age

A new npm or PyPI release is offered once it is three days old
(`security:minimumReleaseAgeNpm`, `security:minimumReleaseAgePypi`), and a new release of a
GitHub Action or reusable workflow once it is three days old too. The wait gives the registry
and its users time to find and pull a malicious release before Renovate proposes it.

## GitHub Actions

Every action and reusable workflow is pinned to a full commit SHA, with the full version as a
trailing comment:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

A tag can be moved to other code; a commit cannot. Renovate offers no digest update for a
pinned action, because a digest update would mean the tag moved. A new release arrives as a
version update that moves the commit and the comment together.

The one exception is the guard workflow from `polydoc-tech/.github`, pinned with a `# main`
comment. It follows the `main` branch on purpose: its digest update is how a change to the
checks reaches a repo. It gets a branch of its own, `renovate/polydoc-tech-github-workflows`,
and merges once that branch is green.

Release workflows that pin the npm CLI (`npm install -g npm@<version>`) put a marker comment
on the line above, which the custom manager in `default.json` reads:

```yaml
- name: Upgrade npm
  # renovate: datasource=npm depName=npm
  run: npm install -g npm@<version>
```

An update of that pin never merges itself. npm runs in the one job that can mint the publish
token, so a person merges each npm CLI bump. It takes a branch of its own,
`renovate/npm-cli` (`renovate/major-npm-cli` for a major), so it does not hold back the
patch group.

### Checking the rules

The validator accepts a rule that matches nothing. So `.github/workflows/ci.yml` also runs
Renovate itself, on the local platform, over the workflows in `test/action-pins/workflows`,
and `scripts/check-action-pin-rules.mjs` checks what it would open: no digest update for an
action, the guard pin still moves and merges itself, and the npm CLI pin's updates sit alone
with auto-merge off. Locally:

```sh
node --test scripts/check-action-pin-rules.test.mjs
node scripts/check-action-pin-rules.mjs build /tmp/action-pins
(cd /tmp/action-pins && LOG_LEVEL=trace LOG_FORMAT=json \
  npx --yes --package renovate renovate --platform=local \
  --enabled-managers=github-actions,custom.regex > /tmp/renovate-dry-run.ndjson)
node scripts/check-action-pin-rules.mjs judge /tmp/renovate-dry-run.ndjson
```

The build directory has to sit outside any git checkout.

The validator also cannot tell a working custom manager from one whose file pattern matches
nothing in any repo. So CI clones every public polydoc-tech repo that is neither a fork nor
archived, and `scripts/check-custom-managers.mjs` fails when a marker comment is not read by a manager,
or an `npm install -g npm@` line has no marker above it. Locally, with the repos checked out
next to this one:

```sh
node --test scripts/check-custom-managers.test.mjs
node scripts/check-custom-managers.mjs ../activepieces-polydoc ../polydoc-mcp
```

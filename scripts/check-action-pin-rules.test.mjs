// Runs check-action-pin-rules.mjs as a subprocess.
// Run: node --test scripts/check-action-pin-rules.test.mjs
//
// `build` is tested against this repo's real presets and fixture. `judge` is tested against
// small logs written here, which hold only the fields the check reads, with the names and
// nesting of a Renovate 44.145.1 trace log. They prove the check's own logic. That Renovate
// still writes those records is proved by the CI job, which runs the real thing.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const SCRIPT = new URL('./check-action-pin-rules.mjs', import.meta.url).pathname
const ROOT = new URL('../', import.meta.url)
const readJson = (name) => JSON.parse(readFileSync(new URL(name, ROOT), 'utf8'))

const work = mkdtempSync(join(tmpdir(), 'action-pin-rules-test-'))
after(() => rmSync(work, { recursive: true, force: true }))

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

const PLANTED = '.github/workflows/01-tag-moved-off-the-pin.yml'
const GUARD_FILE = '.github/workflows/04-guard-pin.yml'
const GUARD_BRANCH = 'renovate/polydoc-tech-github-workflows'
const PATCHES = 'renovate/dependency-updates-(patches)'
const NPM_FILE = '.github/workflows/release.yml'
const NPM_BRANCH = 'renovate/npm-cli'

const plantedDep = (updates) => ({
  packageFile: PLANTED,
  deps: [{ depName: 'actions/checkout', depType: 'action', currentValue: 'v7.0.1', currentDigest: '9c091bb21b', updates }],
})
const guardDep = {
  packageFile: GUARD_FILE,
  deps: [{ depName: 'polydoc-tech/.github', depType: 'workflow', currentValue: 'main', updates: [{ updateType: 'digest' }] }],
}
const guardUpgrade = (over = {}) => ({
  depName: 'polydoc-tech/.github',
  depType: 'workflow',
  updateType: 'digest',
  automerge: true,
  packageFile: GUARD_FILE,
  ...over,
})
const npmFile = (updates = [{ updateType: 'patch' }, { updateType: 'major' }]) => ({
  packageFile: NPM_FILE,
  deps: [{ depName: 'npm', datasource: 'npm', currentValue: '10.9.0', updates }],
})
const npmUpgrade = (over = {}) => ({
  depName: 'npm',
  manager: 'regex',
  updateType: 'patch',
  automerge: false,
  packageFile: NPM_FILE,
  ...over,
})
// A Docker image's digest update and an action's patch update: both belong in a branch.
const patchesBranch = (...more) => ({
  branchName: PATCHES,
  upgrades: [
    { depName: 'postgres', depType: 'service', updateType: 'digest', automerge: true },
    { depName: 'actions/checkout', depType: 'action', updateType: 'patch', automerge: true },
    ...more,
  ],
})

const npmBranches = [
  { branchName: NPM_BRANCH, automerge: false, upgrades: [npmUpgrade()] },
  { branchName: 'renovate/major-npm-cli', automerge: false, upgrades: [npmUpgrade({ updateType: 'major' })] },
]

const holds = {
  files: [plantedDep([{ updateType: 'digest', newDigest: '3d3c42e5aa' }]), guardDep],
  npm: [npmFile()],
  branches: [{ branchName: GUARD_BRANCH, upgrades: [guardUpgrade()] }, patchesBranch(), ...npmBranches],
}
const lookupRecord = (files = holds.files, npm = holds.npm) => ({
  msg: 'packageFiles with updates',
  config: { 'github-actions': files, regex: npm },
})

function judge({ files, npm = holds.npm, branches }, { records } = {}) {
  const lines = records ?? [
    { msg: 'Renovate started', renovateVersion: '44.145.1' },
    lookupRecord(files, npm),
    { msg: 'branches', branches },
  ]
  const path = join(mkdtempSync(join(work, 'log-')), 'renovate.ndjson')
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return run('judge', path)
}

test('build writes every fixture workflow and default.json', () => {
  const dir = join(mkdtempSync(join(work, 'build-')), 'repo')
  const r = run('build', dir)
  assert.equal(r.code, 0, r.err)

  const fixture = readdirSync(new URL('test/action-pins/workflows/', ROOT)).sort()
  assert.deepEqual(readdirSync(join(dir, '.github', 'workflows')).sort(), fixture)
  assert.ok(fixture.includes(PLANTED.split('/').pop()))
  assert.ok(fixture.includes(GUARD_FILE.split('/').pop()))
  assert.ok(fixture.includes(NPM_FILE.split('/').pop()))

  const { $schema: _schema, ...base } = readJson('default.json')
  const config = JSON.parse(readFileSync(join(dir, 'renovate.json'), 'utf8'))
  assert.deepEqual(config, base)
})

test('build refuses a directory that already holds files', () => {
  const dir = mkdtempSync(join(work, 'used-'))
  writeFileSync(join(dir, 'renovate.json'), '{}\n')
  const r = run('build', dir)
  assert.equal(r.code, 2)
  assert.match(r.err, /is not empty/)
  assert.equal(readFileSync(join(dir, 'renovate.json'), 'utf8'), '{}\n')
})

test('a run in which the rules hold passes and names the Renovate version', () => {
  const r = judge(holds)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^Renovate 44\.145\.1$/m)
  assert.equal(r.out.match(/^ok {4}/gm).length, 5)
})

test('a digest update of an action in a branch fails', () => {
  const followed = { depName: 'actions/checkout', depType: 'action', updateType: 'digest', packageFile: PLANTED }
  const r = judge({ ...holds, branches: [holds.branches[0], patchesBranch(followed)] })
  assert.equal(r.code, 1)
  assert.match(r.err, /dependency-updates-\(patches\) holds a digest update of actions\/checkout/)
})

test('a digest update of a reusable workflow other than the guard fails', () => {
  const followed = { depName: 'octo-org/shared', depType: 'workflow', updateType: 'digest', packageFile: 'x.yml' }
  const r = judge({ ...holds, branches: [holds.branches[0], patchesBranch(followed)] })
  assert.equal(r.code, 1)
  assert.match(r.err, /holds a digest update of octo-org\/shared/)
})

test('the guard pin with no digest update in any branch fails', () => {
  const r = judge({ ...holds, branches: [patchesBranch()] })
  assert.equal(r.code, 1)
  assert.match(r.err, /no branch holds the digest update of the polydoc-tech\/\.github pin/)
})

test('the guard pin held as pending fails, on the upgrade or on its branch', () => {
  const onUpgrade = judge({ ...holds, branches: [{ branchName: GUARD_BRANCH, upgrades: [guardUpgrade({ pendingChecks: true })] }] })
  assert.equal(onUpgrade.code, 1)
  assert.match(onUpgrade.err, /is pending in renovate\/polydoc-tech-github-workflows/)

  const onBranch = judge({ ...holds, branches: [{ branchName: GUARD_BRANCH, pendingChecks: true, upgrades: [guardUpgrade()] }] })
  assert.equal(onBranch.code, 1)
  assert.match(onBranch.err, /is pending in renovate\/polydoc-tech-github-workflows/)
})

test('the guard pin without auto-merge fails', () => {
  const r = judge({ ...holds, branches: [{ branchName: GUARD_BRANCH, upgrades: [guardUpgrade({ automerge: false })] }] })
  assert.equal(r.code, 1)
  assert.match(r.err, /does not merge itself/)
})

test('a planted pin the lookup offers no digest update for fails', () => {
  const r = judge({ ...holds, files: [plantedDep([{ updateType: 'patch' }]), guardDep] })
  assert.equal(r.code, 1)
  assert.match(r.err, /offers no digest update for the planted pin/)
})

test('a log without the branches record cannot be judged', () => {
  const r = judge(holds, {
    records: [
      { msg: 'Renovate started', renovateVersion: '44.145.1' },
      lookupRecord(),
    ],
  })
  assert.equal(r.code, 2)
  assert.match(r.err, /no "branches" record/)
})

test('a log cut short in the middle of a record cannot be judged', () => {
  const path = join(mkdtempSync(join(work, 'log-')), 'renovate.ndjson')
  writeFileSync(path, `${JSON.stringify({ msg: 'Renovate started', renovateVersion: '44.145.1' })}\n{"msg":"branches","branches":[{"branchName"`)
  const r = run('judge', path)
  assert.equal(r.code, 2)
  assert.match(r.err, /line 2 of the log is not JSON/)
})

test('an upgrade that carries no dep type cannot be judged', () => {
  const r = judge({ ...holds, branches: [{ branchName: GUARD_BRANCH, upgrades: [guardUpgrade({ depType: undefined })] }] })
  assert.equal(r.code, 2)
  assert.match(r.err, /dep type of an upgrade can no longer be read/)
})

test('the messages of warnings and errors are printed, and nothing else of them', () => {
  const warning = { level: 40, msg: 'GitHub token is required for some dependencies', detail: 'not-for-the-log' }
  const r = judge(holds, {
    records: [
      { level: 30, msg: 'Renovate started', renovateVersion: '44.145.1' },
      warning,
      warning,
      { level: 50, msg: 'lookup failed' },
      { level: 20, ...lookupRecord() },
      { level: 10, msg: 'branches', branches: holds.branches },
    ],
  })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^Renovate logged 2 x warn: GitHub token is required for some dependencies$/m)
  assert.match(r.out, /^Renovate logged 1 x error: lookup failed$/m)
  assert.doesNotMatch(r.out + r.err, /not-for-the-log/)
})

test('build refuses a path that is a file', () => {
  const file = join(mkdtempSync(join(work, 'file-')), 'taken')
  writeFileSync(file, 'x')
  const r = run('build', file)
  assert.equal(r.code, 2)
  assert.match(r.err, /^cannot run: /)
  assert.equal(readFileSync(file, 'utf8'), 'x')
})

test('a run that extracted no dependency cannot be judged', () => {
  const r = judge({ files: [], npm: [], branches: [] })
  assert.equal(r.code, 2)
  assert.match(r.err, /extracted 0 dependencies/)
})

test('a record that only carries the message name deeper down is not read as that record', () => {
  const r = judge(holds, {
    records: [
      { msg: 'Renovate started', renovateVersion: '44.145.1' },
      lookupRecord(),
      { msg: 'branches', branches: holds.branches },
      { msg: 'something else', nested: { msg: 'branches', branches: [] } },
    ],
  })
  assert.equal(r.code, 0, r.err)
})

const withoutNpmBranches = holds.branches.filter((b) => !b.branchName.includes('npm-cli'))

test('the npm pin in the auto-merging patch group fails twice', () => {
  // What default.json did before the npm CLI rule.
  const r = judge({ ...holds, branches: [...withoutNpmBranches.filter((b) => b.branchName !== PATCHES), { ...patchesBranch(npmUpgrade({ automerge: true })), automerge: true }, npmBranches[1]] })
  assert.equal(r.code, 1)
  assert.match(r.err, /the patch update of the npm pin in renovate\/dependency-updates-\(patches\) merges itself/)
  assert.match(r.err, /the patch update of the npm pin shares renovate\/dependency-updates-\(patches\) with 2 other update\(s\)/)
})

test('an npm pin update that merges itself fails, on the upgrade or on its branch', () => {
  const onUpgrade = judge({ ...holds, branches: [...withoutNpmBranches, { branchName: NPM_BRANCH, upgrades: [npmUpgrade({ automerge: true })] }] })
  assert.equal(onUpgrade.code, 1)
  assert.match(onUpgrade.err, /the patch update of the npm pin in renovate\/npm-cli merges itself/)

  const major = judge({ ...holds, branches: [...withoutNpmBranches, npmBranches[0], { branchName: 'renovate/major-npm-cli', automerge: true, upgrades: [npmUpgrade({ updateType: 'major' })] }] })
  assert.equal(major.code, 1)
  assert.match(major.err, /the major update of the npm pin in renovate\/major-npm-cli merges itself/)
})

test('an npm pin update that shares its branch fails, even with auto-merge off', () => {
  const other = { depName: 'actions/setup-node', depType: 'action', updateType: 'minor', automerge: false }
  const r = judge({ ...holds, branches: [...withoutNpmBranches, { branchName: NPM_BRANCH, automerge: false, upgrades: [npmUpgrade(), other] }] })
  assert.equal(r.code, 1)
  assert.match(r.err, /shares renovate\/npm-cli with 1 other update\(s\)/)
})

test('an npm pin with no patch update in any branch fails', () => {
  const r = judge({ ...holds, branches: [...withoutNpmBranches, npmBranches[1]] })
  assert.equal(r.code, 1)
  assert.match(r.err, /no branch holds the patch update of the npm pin/)
})

test('an npm pin the lookup offers no patch update for fails', () => {
  const r = judge({ ...holds, npm: [npmFile([{ updateType: 'major' }])] })
  assert.equal(r.code, 1)
  assert.match(r.err, /offers no patch update for the npm pin/)
})

test('a run in which the custom manager read no npm pin cannot be judged', () => {
  const none = judge({ ...holds, npm: undefined }, {
    records: [
      { msg: 'Renovate started', renovateVersion: '44.145.1' },
      { msg: 'packageFiles with updates', config: { 'github-actions': holds.files } },
      { msg: 'branches', branches: holds.branches },
    ],
  })
  assert.equal(none.code, 2)
  assert.match(none.err, /the custom manager read no npm pin from \.github\/workflows\/release\.yml/)

  const elsewhere = judge({ ...holds, npm: [{ ...npmFile(), packageFile: '.github/workflows/ci.yml' }] })
  assert.equal(elsewhere.code, 2)
})

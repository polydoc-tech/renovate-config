// Runs check-custom-managers.mjs as a subprocess against repos planted in a temp directory,
// read with this repo's real default.json.
// Run: node --test scripts/check-custom-managers.test.mjs

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const SCRIPT = new URL('./check-custom-managers.mjs', import.meta.url).pathname

const work = mkdtempSync(join(tmpdir(), 'custom-managers-test-'))
after(() => rmSync(work, { recursive: true, force: true }))

let planted = 0
function repo(files) {
  const dir = join(work, `repo-${++planted}`)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

function run(...dirs) {
  const r = spawnSync(process.execPath, [SCRIPT, ...dirs], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

const step = (marker, pin) =>
  `jobs:\n  publish:\n    steps:\n      - name: Upgrade npm\n${marker ? `        # ${marker}\n` : ''}        run: ${pin}\n`
const MARKED = step('renovate: datasource=npm depName=npm', 'npm install -g npm@12.2.3')

test('a marked npm pin in release.yml passes', () => {
  const r = run(repo({ '.github/workflows/release.yml': MARKED }))
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /ok: 1 marker comment\(s\) read, 1 npm pin\(s\) covered, across 1 repo\(s\)/)
})

test('an npm pin without a marker fails', () => {
  const r = run(
    repo({ '.github/workflows/release.yml': MARKED }),
    repo({ '.github/workflows/release.yml': step(null, 'npm install -g npm@12.2.3') }),
  )
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /release\.yml: pins npm@12\.2\.3 in a run: line that no manager reads/)
})

test('a marker in a workflow outside the manager file patterns fails', () => {
  const r = run(
    repo({ '.github/workflows/release.yml': MARKED }),
    repo({ '.github/workflows/publish.yml': MARKED }),
  )
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /publish\.yml: carries 1 marker comment\(s\) that no manager's file pattern claims/)
})

test('a marker the manager cannot read fails', () => {
  const unread = MARKED + step('renovate: datasource=npm depName=npm', 'npm install -g npm@latest')
  const r = run(repo({ '.github/workflows/release.yml': unread }))
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /marker comment on line 11 is not read by default\.json/)
})

test('a marker naming another package above the npm pin fails', () => {
  const r = run(repo({
    '.github/workflows/release.yml': step('renovate: datasource=npm depName=pnpm', 'npm install -g npm@12.2.3'),
  }))
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /the marker above npm@12\.2\.3 reads npm\/pnpm, not npm\/npm/)
})

test('a run that finds no marker and no pin fails', () => {
  const r = run(repo({ '.github/workflows/ci.yml': 'jobs: {}\n' }))
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /no marker comment read in any of the 1 directories/)
  assert.match(r.out, /no npm install -g npm@ pin found in any of the 1 directories/)
})

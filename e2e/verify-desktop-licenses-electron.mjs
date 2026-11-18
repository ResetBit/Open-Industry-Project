// Check that the license files are produced and included by the desktop build configuration.
// Run after npm run build. The desktop notices are generated here, as npm run pack does.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const { build } = JSON.parse(read('apps/desktop/package.json'))
execFileSync(process.execPath, [join(root, 'scripts', 'desktop-licenses.mjs')], { stdio: 'inherit' })

assert(build.extraResources.some(({ from, to, filter }) => from === '../../dist' && to === 'dist' && filter.includes('**/*')))
assert(build.files.includes('THIRD_PARTY_LICENSES.desktop.txt'))
assert.equal(read('dist/LICENSE'), read('LICENSE'))
assert.equal(read('dist/THIRD_PARTY_NOTICES.md'), read('THIRD_PARTY_NOTICES.md'))
const web = read('dist/THIRD_PARTY_LICENSES.txt')
for (const pkg of ['three@', 'react@', 'jolt-physics@', 'draco (Google Draco']) assert(web.includes(pkg), pkg)
const desktop = read('apps/desktop/THIRD_PARTY_LICENSES.desktop.txt')
for (const pkg of ['node-opcua-client@', 'BSD-3-Clause', 'libplctag']) assert(desktop.includes(pkg), pkg)

console.log('PASS: the desktop build includes the web and desktop license files')

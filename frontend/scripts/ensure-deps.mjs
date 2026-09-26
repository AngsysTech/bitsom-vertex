// Runs before `npm run dev` / `npm run build`: makes sure node_modules was installed from the current
// package-lock.json with the current Node version, and reinstalls (npm ci) if not. This repairs a stale
// or half-installed node_modules (e.g. "Cannot find native binding") without any manual steps.
// `--stamp` only records the current install (used by postinstall after a manual npm install).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lockPath = path.join(root, 'package-lock.json')
const stampPath = path.join(root, 'node_modules', '.deps-stamp')

const [major] = process.versions.node.split('.').map(Number)
if (major < 20) {
  console.error(`\n✖ Node ${process.version} is too old for this project. Install Node 20 or newer (e.g. \`nvm install 22\`).\n`)
  process.exit(1)
}

const hasLock = existsSync(lockPath)
const want = createHash('sha1')
  .update(hasLock ? readFileSync(lockPath) : '')
  .update(`${process.version} ${process.platform} ${process.arch}`)
  .digest('hex')
const writeStamp = () => existsSync(path.dirname(stampPath)) && writeFileSync(stampPath, want)

if (process.argv.includes('--stamp')) {
  writeStamp()
  process.exit(0)
}

const have = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : ''
if (have !== want) {
  const cmd = hasLock ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund'
  console.log(`\n› node_modules is out of date for this lockfile / Node ${process.version} — running \`${cmd}\` (one-time, ~30s)…\n`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
  writeStamp()
  console.log('\n✔ Dependencies ready.\n')
}

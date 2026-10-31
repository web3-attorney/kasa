import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

// Load .env manually
const envPath = path.resolve('/home/user/app/.env')
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  const key = trimmed.slice(0, idx).trim()
  const val = trimmed.slice(idx + 1).trim()
  if (!process.env[key]) process.env[key] = val
}

const require = createRequire(import.meta.url)
const { registerEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets')

const apiKey = process.env.CIRCLE_API_KEY
if (!apiKey) { console.error('CIRCLE_API_KEY not set'); process.exit(1) }

// Generate fresh 32-byte secret without printing it
const entitySecret = crypto.randomBytes(32).toString('hex')

const recoveryDir = '/home/user/app/.circle'
fs.mkdirSync(recoveryDir, { recursive: true })

console.log('Registering entity secret with Circle...')
const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
})

if (response.data?.recoveryFile) {
  const recoveryPath = path.join(recoveryDir, 'recovery_file.dat')
  fs.writeFileSync(recoveryPath, response.data.recoveryFile)
  console.log('Recovery file written to .circle/recovery_file.dat')
}

// Write CIRCLE_ENTITY_SECRET to .env (replace existing)
const currentEnv = fs.readFileSync(envPath, 'utf-8')
const updatedEnv = currentEnv.includes('CIRCLE_ENTITY_SECRET=')
  ? currentEnv.replace(/^CIRCLE_ENTITY_SECRET=.*$/m, `CIRCLE_ENTITY_SECRET=${entitySecret}`)
  : currentEnv + `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`
fs.writeFileSync(envPath, updatedEnv)
console.log('CIRCLE_ENTITY_SECRET written to .env')

// Verify registration
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets')
const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
const verify = await client.listWalletSets({ pageSize: 1 })
console.log('Verification status:', verify.status, '— registration confirmed')
console.log('DONE')

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Read API key from .env without printing it
const envRaw = fs.readFileSync(path.join(root, '.env'), 'utf-8')
const apiKey = envRaw.match(/^CIRCLE_API_KEY=(.+)$/m)?.[1]?.trim()
if (!apiKey) { console.error('CIRCLE_API_KEY not found in .env'); process.exit(1) }

// Check if already registered
if (envRaw.includes('CIRCLE_ENTITY_SECRET=')) {
  console.log('CIRCLE_ENTITY_SECRET already set — skipping registration')
  process.exit(0)
}

const entitySecret = crypto.randomBytes(32).toString('hex')

const recoveryDir = path.join(root, '.circle')
fs.mkdirSync(recoveryDir, { recursive: true })

const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
})

const recoveryPath = path.join(recoveryDir, 'recovery_file.dat')
if (response.data?.recoveryFile) {
  fs.writeFileSync(recoveryPath, response.data.recoveryFile)
}

// Append to .env
fs.appendFileSync(path.join(root, '.env'), `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`)

// Verify
const { initiateDeveloperControlledWalletsClient } = await import('@circle-fin/developer-controlled-wallets')
const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
await client.listWalletSets({ pageSize: 1 })

console.log('SUCCESS')
console.log('RECOVERY_PATH:' + recoveryPath)

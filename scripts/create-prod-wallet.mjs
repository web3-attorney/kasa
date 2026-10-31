import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { readFileSync, appendFileSync } from 'node:fs'
import { config } from 'dotenv'

config()

const apiKey = process.env.CIRCLE_API_KEY
const entitySecret = process.env.CIRCLE_ENTITY_SECRET

if (!apiKey || !entitySecret) { console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET'); process.exit(1) }

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })

// Create wallet set
console.log('Creating production wallet set...')
const wsRes = await client.createWalletSet({ name: 'Kasa Production' })
const walletSetId = wsRes.data?.walletSet?.id
if (!walletSetId) { console.error('Failed to create wallet set:', JSON.stringify(wsRes)); process.exit(1) }
console.log('Wallet set ID:', walletSetId)

// Create dev wallet on Arc Mainnet
console.log('Creating dev wallet on ARC-MAINNET...')
const wRes = await client.createWallets({
  blockchains: ['ARC'],
  count: 1,
  walletSetId,
})
const wallet = wRes.data?.wallets?.[0]
if (!wallet) { console.error('Failed to create wallet:', JSON.stringify(wRes)); process.exit(1) }

console.log('Dev wallet ID:', wallet.id)
console.log('Dev wallet address:', wallet.address)

// Write to .env
appendFileSync('/home/user/app/.env', `\nPROD_DEV_WALLET_ID=${wallet.id}\nPROD_DEV_WALLET_ADDRESS=${wallet.address}\n`)
console.log('Written to .env as PROD_DEV_WALLET_ID and PROD_DEV_WALLET_ADDRESS')
console.log('DONE')

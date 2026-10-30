import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'
import { getOrCreateWalletSet, circleGet, circlePost, REGISTRY_ADDR, rpcCall } from '../_shared/circle.ts'
import { SignJWT } from 'https://deno.land/x/jose@v4.15.4/index.ts'

const JWT_SECRET = new TextEncoder().encode(Deno.env.get('JWT_SECRET')!)

async function encodePackedHash(username: string, salt: string): Promise<string> {
  const usernameHex = Array.from(new TextEncoder().encode(username)).map(b => b.toString(16).padStart(2,'0')).join('')
  const saltHex = salt.replace('0x','').padStart(64,'0')
  return await rpcCall<string>('web3_sha3', ['0x' + usernameHex + saltHex])
}

async function registerUsernameOnchain(walletId: string, address: string, username: string) {
  if (!REGISTRY_ADDR || username.length < 3) return
  try {
    const salt = '0x' + address.toLowerCase().replace('0x','').padStart(64,'0')
    const commitment = await encodePackedHash(username, salt)
    if (!commitment || commitment === '0x') return
    await circlePost('/developer/transactions/contractExecution', {
      walletId, contractAddress: REGISTRY_ADDR,
      abiFunctionSignature: 'commit(bytes32)', abiParameters: [commitment],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: `commit-${walletId}-${username}`,
    })
    await new Promise(r => setTimeout(r, 4000))
    await circlePost('/developer/transactions/contractExecution', {
      walletId, contractAddress: REGISTRY_ADDR,
      abiFunctionSignature: 'register(string,bytes32)', abiParameters: [username, salt],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: `register-${walletId}-${username}`,
    })
  } catch (e) { console.warn('[registry] failed:', e) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const { userId, username: requestedUsername } = await req.json() as { userId?: string; username?: string }
    if (!userId) return err('userId required')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: existingProfile } = await sb.from('profiles').select('username').eq('user_id', userId).single()
    const finalUsername = existingProfile?.username ?? requestedUsername
    if (!finalUsername) return err('username required for new users')

    const wsId = await getOrCreateWalletSet()
    // Find existing wallet by refId
    const walletListRes = await circleGet(`/developer/wallets?walletSetId=${wsId}&pageSize=50`)
    const wallets = walletListRes.data?.wallets ?? []
    const existing = wallets.find((w: { refId?: string }) => w.refId === userId)

    let walletId: string, address: string, isNew = false
    if (existing) {
      walletId = existing.id; address = existing.address
    } else {
      isNew = true
      const cr = await circlePost('/developer/wallets', {
        accountType: 'EOA', blockchains: ['ARC-TESTNET'], count: 1,
        walletSetId: wsId,
        metadata: [{ name: `Kasa:${userId}`, refId: userId }],
        idempotencyKey: `wallet-${userId}`,
      })
      const w = cr.data?.wallets?.[0]
      if (!w) throw new Error('Wallet creation failed')
      walletId = w.id; address = w.address
    }

    if (!existingProfile) {
      await sb.from('profiles').upsert({ user_id: userId, username: finalUsername, created_at: Date.now() })
    }

    const token = await new SignJWT({ userId, walletId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    // Register username onchain in background (new wallets only)
    if (isNew && address) {
      EdgeRuntime.waitUntil(registerUsernameOnchain(walletId, address, finalUsername))
    }

    return json({ walletId, address, username: finalUsername, token })
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
})

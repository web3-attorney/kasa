import { corsResponse, json, err } from '../_shared/cors.ts'
import { execContract } from '../_shared/circle.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const { walletId, contractAddress, abiFunctionSignature, abiParameters } = await req.json() as {
      walletId?: string; contractAddress?: string; abiFunctionSignature?: string; abiParameters?: (string|number|boolean)[]
    }
    if (!walletId || !contractAddress || !abiFunctionSignature) return err('walletId, contractAddress, abiFunctionSignature required')
    const result = await execContract(walletId, contractAddress, abiFunctionSignature, (abiParameters ?? []).map(String))
    return json(result)
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
})

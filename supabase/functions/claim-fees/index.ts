// Supabase Edge Function: claim-fees
// Uses the exact Inkwell creator-fee claiming flow: prepare -> sign -> broadcast
// Claims fees for both LESS and MORE pools of a pick.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type Body = { pickId?: string; pools?: string[] }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

async function postJson(url: string, payload: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

function parsePrivateKey(privateKeyString: string) {
  if (!privateKeyString) throw new Error('Private key is required')
  // base64
  try {
    const secretKey = Buffer.from(privateKeyString, 'base64')
    if (secretKey.length === 64) return (window as any)?.Keypair?.fromSecretKey(secretKey)
  } catch {}
  // base58
  try {
    const bs58 = (await import('npm:bs58')).default
    const decoded = bs58.decode(privateKeyString)
    if (decoded.length === 64) return (window as any)?.Keypair?.fromSecretKey(decoded)
  } catch {}
  // JSON array
  try {
    const keyArray = JSON.parse(privateKeyString)
    if (Array.isArray(keyArray) && keyArray.length === 64) return (window as any)?.Keypair?.fromSecretKey(new Uint8Array(keyArray))
  } catch {}
  // CSV
  try {
    const values = privateKeyString.split(',').map((v) => parseInt(v.trim(), 10))
    if (values.length === 64 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
      return (window as any)?.Keypair?.fromSecretKey(new Uint8Array(values))
  } catch {}
  throw new Error('Invalid private key format')
}

async function claimCreatorFeesSingleCall({ backendUrl, userId, poolAddress, creatorPrivateKey }: any) {
  // Call the backend exactly like in inkwell-feed: one POST including creatorPrivateKey
  console.log('[claim-fees] single-call start pool', poolAddress, 'userId', userId)
  const resp = await postJson(`${backendUrl}/api/claim-creator-fees`, {
    poolAddress,
    userId,
    creatorPrivateKey,
  })
  console.log('[claim-fees] single-call resp pool', poolAddress, 'status', resp.status, 'ok', resp.ok, 'body', JSON.stringify(resp.data))
  if (!resp.ok || !resp.data?.success) throw new Error(resp.data?.error || 'Claim failed')
  return { success: true, transactionSignature: resp.data?.transactionSignature }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const BACKEND_URL = getEnv('BACKEND_URL') || 'https://blockparty-backend-production.up.railway.app'
    const BACKEND_USER_ID = getEnv('BACKEND_USER_ID', true)!
    const BACKEND_USER_PRIVATE_KEY = getEnv('BACKEND_USER_PRIVATE_KEY', true)!

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    let body: Body
    try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }
    const pickId = body?.pickId?.trim?.() || ''
    let pools: string[] | null = Array.isArray(body?.pools) ? body!.pools! : null

    console.log('[claim-fees] request body', JSON.stringify(body))
    if (!pools) {
      if (!pickId) return json(400, { error: 'pickId or pools[] required' })
      const { data, error } = await supabase.from('picks').select('id, lesspool, morepool, expires_at, status').eq('id', pickId).single()
      if (error || !data) return json(404, { error: 'Pick not found' })
      pools = [data.lesspool, data.morepool].filter(Boolean)
      console.log('[claim-fees] pick', pickId, 'status', data.status, 'expires_at', data.expires_at, 'pools', pools)
      if (!pools.length) return json(400, { error: 'No pools available on this pick' })
    }

    // creator private key to pass to backend (exact inkwell pattern)
    const CREATOR_PK = BACKEND_USER_PRIVATE_KEY

    // Update status to claiming if pickId provided
    if (pickId) {
      try { await supabase.from('picks').update({ status: 'claiming', last_claim_attempt: new Date().toISOString() }).eq('id', pickId) } catch {}
    }

    const results: any[] = []
    for (const pool of pools) {
      try {
        const r = await claimCreatorFeesSingleCall({ backendUrl: BACKEND_URL.replace(/\/$/, ''), userId: BACKEND_USER_ID, poolAddress: pool, creatorPrivateKey: CREATOR_PK })
        results.push({ pool, ok: true, transactionSignature: r.transactionSignature })
      } catch (e) {
        results.push({ pool, ok: false, error: (e as Error)?.message || String(e) })
      }
    }

    const allOk = results.every(r => r.ok)
    if (pickId) {
      console.log('[claim-fees] results for pick', pickId, JSON.stringify(results))
      try {
        await supabase.from('picks').update({ status: allOk ? 'settled' : 'failed', settled_at: allOk ? new Date().toISOString() : null }).eq('id', pickId)
      } catch {}
    }

    return json(200, { success: allOk, results })
  } catch (e) {
    return json(500, { error: (e as Error)?.message || String(e) })
  }
})

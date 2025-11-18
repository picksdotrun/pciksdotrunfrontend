// Supabase Edge Function: claim-evm-market
// Relays claim requests to the Railway backend and returns the payout information.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type ClaimBody = {
  pickId: string
  marketAddress: string
  wallet: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

async function postJson(url: string, payload: any, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  let body: ClaimBody
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }
  const pickId = body?.pickId?.trim()
  const marketAddress = body?.marketAddress?.trim()
  const wallet = body?.wallet?.trim()
  if (!pickId) return json(400, { error: 'pickId is required' })
  if (!marketAddress) return json(400, { error: 'marketAddress is required' })
  if (!wallet) return json(400, { error: 'wallet is required' })

  const BACKEND_URL = 'https://picksbackend-production.up.railway.app'
  const SUPABASE_URL = getEnv('SUPABASE_URL')
  const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')

  const resp = await postJson(`${BACKEND_URL}/api/claim-market`, {
    pickId,
    marketAddress,
    wallet,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
  })
  if (!resp.ok || !resp.data?.success) {
    return json(500, { error: 'backend_claim_failed', details: resp.data, status: resp.status })
  }
  return json(200, resp.data)
})

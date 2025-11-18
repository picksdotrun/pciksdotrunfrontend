// Supabase Edge Function: swap
// Proxies a request to SolanaTracker Swap API to obtain a prebuilt transaction.
// This keeps API keys server-side and avoids exposing the endpoint directly.

type SwapRequest = {
  toMint: string
  fromMint?: string
  payer: string
  amount?: number | string
  slippage?: number | string
  priorityFee?: number | string
  txVersion?: 'legacy' | 'v0'
}

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildUrl(base: string, path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(path, base.endsWith('/') ? base : base + '/')
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    url.searchParams.set(k, String(v))
  }
  return url.toString()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })
  let payload: SwapRequest
  try {
    payload = (await req.json()) as SwapRequest
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const toMint = (payload?.toMint || '').trim()
  const payer = (payload?.payer || '').trim()
  const fromMint = (payload?.fromMint || NATIVE_SOL_MINT).trim()
  const amount = payload?.amount ?? 'auto' // can be number, percentage string, or 'auto'
  const slippage = payload?.slippage ?? 10
  const priorityFee = payload?.priorityFee ?? 'auto'
  const txVersion = payload?.txVersion ?? 'legacy'

  if (!toMint) return jsonResponse(400, { error: 'toMint is required' })
  if (!payer) return jsonResponse(400, { error: 'payer is required' })

  const BASE = Deno.env.get('SOLANA_TRACKER_SWAP_BASE_URL') || 'https://swap-v2.solanatracker.io'
  const API_KEY = Deno.env.get('SOLANA_TRACKER_API_KEY')

  // Send both amount and fromAmount to be compatible with different versions
  const targetUrl = buildUrl(BASE, '/swap', {
    from: fromMint,
    to: toMint,
    amount: typeof amount === 'number' ? amount : String(amount),
    fromAmount: typeof amount === 'number' ? amount : String(amount),
    slippage: typeof slippage === 'number' ? slippage : String(slippage),
    payer,
    priorityFee: typeof priorityFee === 'number' ? priorityFee : String(priorityFee),
    txVersion,
  })

  const headers: Record<string, string> = { 'accept': 'application/json' }
  if (API_KEY) headers['x-api-key'] = API_KEY

  try {
    const res = await fetch(targetUrl, { method: 'GET', headers })
    const text = await res.text()
    let json: any
    try { json = JSON.parse(text) } catch { json = { raw: text } }
    if (!res.ok) return jsonResponse(res.status, { error: 'Swap API error', details: json })
    // Expect shape: { txn: base64, type: 'legacy' | 'v0', rate: { ... } }
    return jsonResponse(200, json)
  } catch (e) {
    return jsonResponse(500, { error: 'Failed to reach Swap API', details: String(e?.message || e) })
  }
})


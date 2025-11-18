// Supabase Edge Function: launch-pair
// Calls the Inkwell backend to launch two tokens (UNDER/OVER) for a pick
// using a designated BlockParty/Inkwell user (to create posts automatically),
// then updates the Picks 'picks' row with the returned mints and pools.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// Hardcoded defaults (edit these if you don't want to use Supabase secrets)
const DEFAULT_BACKEND_URL = 'https://one-source-truth-production.up.railway.app'
const DEFAULT_BACKEND_USER_ID = '54ea1ba1-69f1-4a75-9c85-b123d67b5f05'
// IMPORTANT: Replace this with your actual private key (base64/base58/JSON array) if you choose hardcoding
const DEFAULT_BACKEND_USER_PRIVATE_KEY = 'REPLACE_WITH_PRIVATE_KEY'

type LaunchBody = {
  pickId: string
  name: string
  line: string
  category: string
  description?: string | null
  imageBase64?: string | null // data URL or pure base64
  imageType?: string | null
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

async function postJson(url: string, payload: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

async function postJsonWithRetry(url: string, payload: any, label: string, maxMs = 120000) {
  const started = Date.now()
  let attempt = 0
  let lastErr: any = null
  while (Date.now() - started < maxMs) {
    attempt++
    try {
      console.log('[launch-pair]', label, 'attempt', attempt, 'posting to', url)
      const resp = await postJson(url, payload)
      console.log('[launch-pair]', label, 'attempt', attempt, 'resp status', resp.status, 'ok', resp.ok)
      if (resp.ok && resp.data?.success) return resp
      lastErr = resp.data || { status: resp.status }
    } catch (e) {
      lastErr = (e as Error)?.message || String(e)
      console.warn('[launch-pair]', label, 'attempt', attempt, 'network error', lastErr)
    }
    await sleep(Math.min(5000 + attempt * 1000, 10000))
  }
  console.error('[launch-pair]', label, 'exceeded max wait, lastErr:', JSON.stringify(lastErr))
  throw new Error(typeof lastErr === 'string' ? lastErr : (lastErr?.error || 'launch request failed'))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  let body: LaunchBody
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }

  const pickId = body?.pickId?.trim()
  const name = body?.name?.trim()
  const line = body?.line?.trim()
  const category = body?.category?.trim()
  const description = (body?.description ?? '').toString()
  let imageBase64 = body?.imageBase64 || null
  const imageType = body?.imageType || null

  if (!pickId || !name || !line || !category) {
    return json(400, { error: 'pickId, name, line, category are required' })
  }

  // Env
  const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
  const BACKEND_URL = getEnv('BACKEND_URL') || DEFAULT_BACKEND_URL
  const BACKEND_USER_ID = getEnv('BACKEND_USER_ID') || DEFAULT_BACKEND_USER_ID
  const BACKEND_USER_PRIVATE_KEY = getEnv('BACKEND_USER_PRIVATE_KEY') || DEFAULT_BACKEND_USER_PRIVATE_KEY

  // Supabase client
  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // If no imageBase64 provided, try to read from picks.image if it contains a data URL
  if (!imageBase64) {
    try {
      const { data: row } = await supabase.from('picks').select('image').eq('id', pickId).single()
      const img = (row as any)?.image as string | null
      if (img && typeof img === 'string' && img.startsWith('data:')) {
        imageBase64 = img
      }
    } catch (_) {
      // ignore
    }
  }

  // Common metadata
  const website = 'https://picks.run/'
  const twitter = 'https://x.com/picksdotrun'
  const initialBuyAmount = 0.01

  // Build payload for UNDER and OVER
  const makePayload = (side: 'UNDER' | 'OVER') => {
    const sideName = `${name} ${side} ${line}`
    const base: any = {
      name: sideName,
      symbol: side,
      description,
      website,
      twitter,
      initialBuyAmount,
      userId: BACKEND_USER_ID,
    }
    if (imageBase64) {
      base.imageBase64 = imageBase64
      if (imageType) base.imageType = imageType
    }
    // Always provide the server-side key (backend prefers userPrivateKey when present)
    base.userPrivateKey = BACKEND_USER_PRIVATE_KEY
    return base
  }

  const underPayload = makePayload('UNDER')
  const overPayload = makePayload('OVER')

  const launchUrl = `${BACKEND_URL.replace(/\/$/, '')}/api/launch-token`

  if (!BACKEND_URL || BACKEND_URL === 'https://your-backend-domain') {
    return json(500, { error: 'BACKEND_URL not configured. Set env or edit DEFAULT_BACKEND_URL.' })
  }
  if (!BACKEND_USER_PRIVATE_KEY || BACKEND_USER_PRIVATE_KEY === 'REPLACE_WITH_PRIVATE_KEY') {
    return json(500, { error: 'BACKEND_USER_PRIVATE_KEY not set. Set env or edit DEFAULT_BACKEND_USER_PRIVATE_KEY.' })
  }

  // Launch UNDER first, then OVER
  const underRes = await postJsonWithRetry(launchUrl, underPayload, 'UNDER', 120000)
  if (!underRes.ok || !underRes.data?.success) {
    return json(500, { error: 'UNDER launch failed', details: underRes.data, status: underRes.status })
  }
  const lessMint = underRes.data?.mintAddress
  const lessPool = underRes.data?.poolAddress

  const overRes = await postJsonWithRetry(launchUrl, overPayload, 'OVER', 120000)
  if (!overRes.ok || !overRes.data?.success) {
    // Update partial (LESS) if available, then return error
    try {
      if (lessMint || lessPool) {
        await supabase
          .from('picks')
          .update({ lesstoken: lessMint, lesspool: lessPool })
          .eq('id', pickId)
    }
    } catch (_) {}
    return json(500, { error: 'OVER launch failed', details: overRes.data, status: overRes.status })
  }
  const moreMint = overRes.data?.mintAddress
  const morePool = overRes.data?.poolAddress

  // Persist to picks
  try {
    await supabase
      .from('picks')
      .update({
        lesstoken: lessMint,
        lesspool: lessPool,
        moretoken: moreMint,
        morepool: morePool,
      })
      .eq('id', pickId)
  } catch (e) {
    return json(500, { error: 'DB update failed', details: (e as Error)?.message || String(e) })
  }

  return json(200, { success: true, lessMint, lessPool, moreMint, morePool })
})

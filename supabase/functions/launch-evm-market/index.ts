// Supabase Edge Function: launch-evm-market
// Deploys an EVM PredictionMarket via backend API, then stores addresses on the pick.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type LaunchBody = {
  pickId: string
  name: string
  line?: string | number | null
  category?: string | null
  description?: string | null
  durationSec?: number | string | null
  expiresAt?: string | null
  image?: string | null
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

function toSec(ts: string | number | Date): number {
  if (typeof ts === 'number') return Math.floor(ts)
  const d = ts instanceof Date ? ts : new Date(ts)
  return Math.floor(d.getTime() / 1000)
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
  let body: LaunchBody
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }
  const pickId = body?.pickId?.trim()
  const name = (body?.name || '').toString().trim()
  if (!pickId || !name) return json(400, { error: 'pickId and name are required' })

  // Hardcoded Railway backend URL per request
  const BACKEND_URL = 'https://picksbackend-production.up.railway.app'
  const SUPABASE_URL = getEnv('SUPABASE_URL')
  const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')
  const ANON_KEY = getEnv('SUPABASE_ANON_KEY')
  const PUBLIC_SITE_URL = getEnv('PUBLIC_SITE_URL')
  let supabaseClient: any = null
  if (SUPABASE_URL && SERVICE_ROLE_KEY) {
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    supabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  }
  // Delegate fully to backend endpoint (will deploy and update DB)
  console.log('[launch-evm-market] request', { pickId, name, backend: BACKEND_URL, durationSec: body?.durationSec, expiresAt: body?.expiresAt })
  const resp = await postJson(`${BACKEND_URL}/api/launch-evm-market`, {
    pickId,
    name,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
    durationSec: body?.durationSec ?? null,
    expiresAt: body?.expiresAt ?? null,
  })
  console.log('[launch-evm-market] backend status', resp.status, 'ok:', resp.ok)
  console.log('[launch-evm-market] backend data', resp.data)
  if (!resp.ok || !resp.data?.success) {
    return json(500, { error: 'backend_launch_failed', details: resp.data, status: resp.status })
  }
  const marketType = resp.data.marketType || (resp.data.asset === 'native' ? 'native_bnb' : 'erc20')
  // If backend skipped DB update, perform it here using service role
  let dbStatus: 'skipped' | 'ok' | 'failed' = 'skipped'
  let dbError: string | null = null
  let pickRow: Record<string, unknown> | null = null
  try {
    if (supabaseClient) {
      const d = resp.data || {}
      const update = {
        evm_market_address: d.marketAddress,
        evm_yes_token_address: d.yesShareAddress,
        evm_no_token_address: d.noShareAddress,
        evm_chain: 'bsc-mainnet',
        evm_asset_address: d.asset,
        evm_market_type: marketType,
        evm_fee_bps: d.feeBps,
        evm_end_time: new Date(Number(d.endTime) * 1000).toISOString(),
        evm_cutoff_time: new Date(Number(d.cutoffTime) * 1000).toISOString(),
      }
      if (update.evm_market_address) {
        const { error } = await supabaseClient.from('picks').update(update).eq('id', pickId)
        if (error) {
          dbStatus = 'failed'
          dbError = error.message
        } else {
          dbStatus = 'ok'
        }
      }
      const { data: pickData, error: pickFetchError } = await supabaseClient
        .from('picks')
        .select('yes_label, yes_value, no_label, no_value, description, line, category, yes_probability')
        .eq('id', pickId)
        .single()
      if (pickFetchError) {
        console.warn('[launch-evm-market] failed to fetch pick row', pickFetchError.message)
      } else {
        pickRow = pickData || null
      }
    }
  } catch (e) {
    dbStatus = 'failed'
    dbError = (e as Error)?.message || String(e)
  }

  let postResult: Record<string, unknown> | null = null
  const functionUrl = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/post-to-x` : null
  if (functionUrl && (SERVICE_ROLE_KEY || ANON_KEY)) {
    const instructions = 'Simply reply "Yes" or "No" underneath this post to instantly place your prediction for free! Claim your earnings as soon as the results are in here: https://picks.run/claim'
    const href = PUBLIC_SITE_URL ? `${PUBLIC_SITE_URL.replace(/\/$/, '')}/pick/${pickId}` : ''
    const postPayload = {
      pickId,
      title: name,
      line: (pickRow?.line ?? body?.line ?? null),
      description: (pickRow?.description ?? body?.description ?? null),
      yes_label: pickRow?.yes_label ?? null,
      yes_value: pickRow?.yes_value ?? null,
      no_label: pickRow?.no_label ?? null,
      no_value: pickRow?.no_value ?? null,
      instructions,
      url: href || null,
      image: (resp.data && resp.data.image) || body?.image || null,
    }
    console.log('[launch-evm-market] calling post-to-x', { endpoint: functionUrl, payload: postPayload })
      try {
        const authToken = (SERVICE_ROLE_KEY || ANON_KEY || '').trim()
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`
          headers['apikey'] = authToken
        }
        const postRes = await fetch(functionUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(postPayload),
        })
        const raw = await postRes.text()
        let parsed: Record<string, unknown> | null = null
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = null
        }
        postResult = { status: postRes.status, ok: postRes.ok, raw, data: parsed }
        console.log('[launch-evm-market] post-to-x response', postResult)
        if (postRes.ok && supabaseClient) {
          const tweetId =
            (parsed as any)?.tweet?.data?.id ||
            (parsed as any)?.tweet?.id ||
            (parsed as any)?.data?.id ||
            null
          if (tweetId) {
            const { error: tweetUpdateError } = await supabaseClient.from('picks').update({ x_tweet_id: tweetId }).eq('id', pickId)
            if (tweetUpdateError) {
              console.warn('[launch-evm-market] failed to save tweet id', tweetUpdateError.message)
            }
          }
        }
      } catch (err) {
        postResult = { error: String(err?.message || err) }
        console.error('[launch-evm-market] post-to-x failed', err)
      }
  } else {
    console.log('[launch-evm-market] post-to-x skipped', { functionUrlExists: !!functionUrl, hasAuth: !!(SERVICE_ROLE_KEY || ANON_KEY) })
  }

  return json(200, { ...resp.data, marketType, dbUpdate: dbStatus, dbError, postToX: postResult })
})

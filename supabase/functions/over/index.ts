// Supabase Edge Function: over
// Updates picks.moreholders and picks.morevolume using SolanaTracker Data API for the MORE token mint.

type Body = { pickId?: string; mint?: string; pool?: string; all?: boolean }

function getApiKey() {
  const direct = Deno.env.get('SOLANA_TRACKER_KEY')
    || Deno.env.get('solana_tracker_key')
    || Deno.env.get('SOLANA_TRACKER_API_KEY')
    || Deno.env.get('SOLANATRACKER_KEY')
  return direct || ''
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function fetchTrackerToken(mint: string, apiKey?: string) {
  const base = 'https://data.solanatracker.io'
  const url = `${base}/tokens/${encodeURIComponent(mint)}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey) headers['x-api-key'] = apiKey
  const res = await fetch(url, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Tracker request failed')
  return data
}

function extractHoldersAndVolume(json: any, preferPool?: string) {
  const holdersRaw = json?.holders ?? json?.token?.holders ?? 0
  const holders = Number.isFinite(Number(holdersRaw)) ? Number(holdersRaw) : 0
  const pools = Array.isArray(json?.pools) ? json.pools : []
  if (preferPool) {
    const found = pools.find((p: any) => p?.poolId === preferPool)
    const v = Number(found?.txns?.volume24h ?? found?.txns?.volume ?? 0)
    return { holders, volume: Number.isFinite(v) ? v : 0 }
  }
  const vol = pools.reduce((acc: number, p: any) => acc + (Number(p?.txns?.volume24h ?? p?.txns?.volume ?? 0) || 0), 0)
  return { holders, volume: vol }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  let body: Body
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }

  const pickId = (body?.pickId || '').trim()
  const mintOverride = (body?.mint || '').trim()
  const poolOverride = (body?.pool || '').trim()
  const runAll = body?.all === true || (!pickId && !mintOverride)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'Missing Supabase service env' })
  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const API_KEY = getApiKey()

  // Bulk mode: update all picks with a moretoken
  if (runAll) {
    try {
      const { data: rows, error } = await supabase
        .from('picks')
        .select('id, moretoken, morepool')
      if (error) throw error
      const total = Array.isArray(rows) ? rows.length : 0
      try { console.log('[over] loaded rows:', total) } catch {}
      let updated = 0
      const results: Array<Record<string, unknown>> = []
      for (const r of rows || []) {
        const mintStr = (r?.moretoken || '').trim()
        if (!mintStr) { results.push({ id: r.id, skip: 'empty moretoken' }); continue }
        try {
          const tokenJson = await fetchTrackerToken(mintStr, API_KEY || undefined)
          const { holders, volume } = extractHoldersAndVolume(tokenJson, r.morepool)
          const patch = { moreholders: holders, morevolume: volume }
          const { error: upErr } = await supabase
            .from('picks')
            .update(patch)
            .eq('id', r.id)
          if (upErr) throw upErr
          updated++
          results.push({ id: r.id, mint: mintStr, pool: r.morepool, holders, volume, ok: true })
        } catch (err) {
          results.push({ id: r.id, mint: mintStr, pool: r.morepool, ok: false, error: err?.message || String(err) })
        }
      }
      try { console.log('[over] bulk updated', updated, 'rows') } catch {}
      return json(200, { success: true, updated, results })
    } catch (e) {
      return json(500, { error: e?.message || 'Failed bulk over refresh' })
    }
  }

  // Single-pick mode
  let mint = mintOverride
  let pool: string | undefined = poolOverride || undefined
  const id = pickId
  if (!mint) {
    const { data, error } = await supabase.from('picks').select('id, moretoken, morepool').eq('id', id).single()
    if (error || !data) return json(404, { error: 'Pick not found' })
    mint = data.moretoken
    pool = data.morepool || pool
  }
  if (!mint) return json(400, { error: 'No MORE mint available for this pick' })
  try {
    const tokenJson = await fetchTrackerToken(mint, API_KEY || undefined)
    const { holders, volume } = extractHoldersAndVolume(tokenJson, pool)
    const patch = { moreholders: holders, morevolume: volume }
    await supabase.from('picks').update(patch).eq('id', id)
    try { console.log('[over] single updated', id, patch) } catch {}
    return json(200, { success: true, id, mint, pool, holders, volume })
  } catch (e) {
    return json(500, { error: e?.message || 'Failed to refresh over metrics' })
  }
})

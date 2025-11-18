// Supabase Edge Function: claim-all
// Simple global claimer. On each run, fetches picks (with both pools) and
// invokes claim-fees for each pick sequentially with service auth.
// Designed to be called by an external cron (Supabase Cron) every minute.

type PickRow = { id: string; lesspool: string | null; morepool: string | null; expires_at?: string | null; status?: string | null }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

async function postJson(url: string, payload: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

async function claimViaBackendSingleCall({ backendUrl, userId, poolAddress, creatorPrivateKey, runId }: any) {
  console.log('[claim-all]', runId, 'single-call start', 'pool', poolAddress)
  const resp = await postJson(`${backendUrl}/api/claim-creator-fees`, { poolAddress, userId, creatorPrivateKey })
  console.log('[claim-all]', runId, 'single-call resp', 'status', resp.status, 'ok', resp.ok, 'body', JSON.stringify(resp.data))
  if (!resp.ok || !resp.data?.success) throw new Error(resp.data?.error || 'claim failed')
  return { success: true, transactionSignature: resp.data?.transactionSignature }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const runId = crypto.randomUUID()
  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const BACKEND_URL = getEnv('BACKEND_URL', true)!
    const BACKEND_USER_ID = getEnv('BACKEND_USER_ID', true)!
    const BACKEND_USER_PRIVATE_KEY = getEnv('BACKEND_USER_PRIVATE_KEY', true)!
    const LIMIT = Number(getEnv('CLAIM_ALL_LIMIT') || '10') || 10
    const DELAY_MS = Number(getEnv('CLAIM_ALL_DELAY_MS') || '1000') || 1000
    const ONLY_EXPIRED = (getEnv('CLAIM_ALL_ONLY_EXPIRED') || 'false').toLowerCase() === 'true'

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    console.log('[claim-all]', runId, 'start', { limit: LIMIT, delay_ms: DELAY_MS, only_expired: ONLY_EXPIRED, backend: BACKEND_URL })

    // Diagnostics: counts
    try {
      const diag = await supabase.from('picks').select('*', { count: 'exact', head: true })
      console.log('[claim-all]', runId, 'diag total picks count', diag.count ?? 'n/a')
      const diagPools = await supabase
        .from('picks')
        .select('*', { count: 'exact', head: true })
        .not('lesspool', 'is', null)
        .not('morepool', 'is', null)
      console.log('[claim-all]', runId, 'diag with both pools count', diagPools.count ?? 'n/a')
      if (ONLY_EXPIRED) {
        const diagExpired = await supabase
          .from('picks')
          .select('*', { count: 'exact', head: true })
          .not('lesspool', 'is', null)
          .not('morepool', 'is', null)
          .lte('expires_at', new Date().toISOString())
        console.log('[claim-all]', runId, 'diag expired with pools count', diagExpired.count ?? 'n/a')
      }
    } catch (e) {
      console.warn('[claim-all]', runId, 'diag error', (e as Error)?.message || String(e))
    }

    // Page through rows in batches of LIMIT
    let processed = 0
    let page = 0
    while (true) {
      console.log('[claim-all]', runId, 'query page', page)
      let q = supabase
        .from('picks')
        .select('id, lesspool, morepool, expires_at, status')
        .not('lesspool', 'is', null)
        .not('morepool', 'is', null)
        .order('created_at', { ascending: true })
        .range(page * LIMIT, page * LIMIT + LIMIT - 1)
      if (ONLY_EXPIRED) q = q.lte('expires_at', new Date().toISOString())
      const { data: rows, error } = await q
      if (error) throw error
      console.log('[claim-all]', runId, 'fetched page', page, 'rows', Array.isArray(rows) ? rows.length : 0)
      if (!rows || rows.length === 0) break

      for (const r of rows as PickRow[]) {
        console.log('[claim-all]', runId, 'pick', r.id, 'status', r.status, 'expires_at', r.expires_at, 'pools', r.lesspool, r.morepool)
        if (!r.lesspool || !r.morepool) { console.log('[claim-all]', runId, 'skip pick missing pools', r.id); continue }
        console.log('[claim-all]', runId, 'claim start pick', r.id)
        // LESS pool
        try {
          console.log('[claim-all]', runId, 'querying pool (LESS)', r.lesspool)
          await claimViaBackendSingleCall({ backendUrl: BACKEND_URL.replace(/\/$/, ''), userId: BACKEND_USER_ID, poolAddress: r.lesspool, creatorPrivateKey: BACKEND_USER_PRIVATE_KEY, runId })
          console.log('[claim-all]', runId, 'claim success (LESS)', r.lesspool)
        } catch (e) {
          console.warn('[claim-all]', runId, 'claim failed (LESS)', r.lesspool, (e as Error)?.message || String(e))
        }
        // MORE pool
        try {
          console.log('[claim-all]', runId, 'querying pool (MORE)', r.morepool)
          await claimViaBackendSingleCall({ backendUrl: BACKEND_URL.replace(/\/$/, ''), userId: BACKEND_USER_ID, poolAddress: r.morepool, creatorPrivateKey: BACKEND_USER_PRIVATE_KEY, runId })
          console.log('[claim-all]', runId, 'claim success (MORE)', r.morepool)
        } catch (e) {
          console.warn('[claim-all]', runId, 'claim failed (MORE)', r.morepool, (e as Error)?.message || String(e))
        }
        console.log('[claim-all]', runId, 'claim end pick', r.id)
        processed++
        if (DELAY_MS > 0) { await new Promise(r => setTimeout(r, DELAY_MS)) }
      }
      page++
    }

    console.log('[claim-all]', runId, 'done processed', processed)
    return json(200, { success: true, runId, processed })
  } catch (e) {
    console.error('[claim-all]', runId, 'fatal', (e as Error)?.message || String(e))
    return json(500, { error: (e as Error)?.message || String(e), runId })
  }
})

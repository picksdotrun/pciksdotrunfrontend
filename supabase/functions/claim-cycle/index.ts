// Supabase Edge Function: claim-cycle
// Cron-friendly worker that iterates over picks and claims fees for both pools
// Calls the internal claim-fees function per pick. Maintains a simple cursor
// so each run continues where it left off. Extensive logging included.

type PickRow = {
  id: string
  created_at: string
  lesspool: string | null
  morepool: string | null
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

async function callFunction(url: string, payload: any, serviceKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (serviceKey) { headers['Authorization'] = `Bearer ${serviceKey}`; headers['apikey'] = serviceKey }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const runId = crypto.randomUUID()
  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const CLAIM_FEES_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/claim-fees`
    const BATCH = Number(getEnv('CLAIM_CYCLE_BATCH') || '1') || 1

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    console.log('[claim-cycle]', runId, 'start, batch =', BATCH)

    // Read/ensure cursor row exists
    let lastCreatedAt: string | null = null
    let lastId: string | null = null
    {
      const { data, error } = await supabase
        .from('claim_cycle_cursor')
        .select('last_created_at, last_id')
        .limit(1)
        .maybeSingle()
      if (error) console.warn('[claim-cycle]', runId, 'cursor fetch error', error.message)
      if (data) { lastCreatedAt = data.last_created_at; lastId = data.last_id }
      else {
        // initialize cursor row
        const { error: initErr } = await supabase.from('claim_cycle_cursor').insert({ id: true, last_created_at: null, last_id: null })
        if (initErr) console.warn('[claim-cycle]', runId, 'cursor init error', initErr.message)
      }
    }

    // Build query to fetch next batch deterministically
    const baseSel = supabase
      .from('picks')
      .select('id, created_at, lesspool, morepool')
      .not('lesspool', 'is', null)
      .not('morepool', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(BATCH)

    let rows: PickRow[] | null = null
    if (lastCreatedAt) {
      // fetch after the last cursor (stable pagination)
      const { data, error } = await baseSel.gt('created_at', lastCreatedAt)
      if (error) throw error
      rows = data as any
      if (!rows || rows.length === 0) {
        // wrap-around from the beginning
        const { data: wrap, error: wrapErr } = await baseSel
        if (wrapErr) throw wrapErr
        rows = wrap as any
      }
    } else {
      const { data, error } = await baseSel
      if (error) throw error
      rows = data as any
    }

    console.log('[claim-cycle]', runId, 'fetched rows', rows?.length || 0, 'cursor last_created_at', lastCreatedAt)
    if (!rows || rows.length === 0) return json(200, { success: true, runId, processed: 0 })

    let processed = 0
    for (const r of rows) {
      console.log('[claim-cycle]', runId, 'processing pick', r.id, 'created_at', r.created_at, 'pools', r.lesspool, r.morepool)
      // Call claim-fees per pick using service key (internal call)
      const resp = await callFunction(CLAIM_FEES_URL, { pickId: r.id }, SUPABASE_SERVICE_ROLE_KEY)
      console.log('[claim-cycle]', runId, 'claim-fees resp pick', r.id, 'status', resp.status, 'ok', resp.ok, 'body', JSON.stringify(resp.data))
      processed++
      // advance cursor to this row
      try {
        await supabase.from('claim_cycle_cursor').update({ last_created_at: r.created_at, last_id: r.id }).eq('id', true)
      } catch (e) { console.warn('[claim-cycle]', runId, 'cursor update error', (e as Error)?.message || String(e)) }
    }

    console.log('[claim-cycle]', runId, 'done processed', processed)
    return json(200, { success: true, runId, processed })
  } catch (e) {
    console.error('[claim-cycle]', runId, 'fatal', (e as Error)?.message || String(e))
    return json(500, { error: (e as Error)?.message || String(e), runId })
  }
})


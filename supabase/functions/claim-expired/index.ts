// Supabase Edge Function: claim-expired
// Scans for expired picks (status open, expires_at <= now), marks them claiming, and invokes claim-fees

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

async function callFunction(url: string, payload: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const PROJECT_REF = SUPABASE_URL.split('https://')[1]?.split('.')[0]
    const CLAIM_FEES_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/claim-fees`

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    // Find expired, open picks
    const nowIso = new Date().toISOString()
    console.log('[claim-expired] tick at', nowIso)
    const { data: rows, error } = await supabase
      .from('picks')
      .select('id, lesspool, morepool, expires_at, status')
      .eq('status', 'open')
      .lte('expires_at', new Date().toISOString())
      .limit(25)
    if (error) throw error
    console.log('[claim-expired] found expired rows:', Array.isArray(rows) ? rows.length : 0)
    if (rows && rows.length) {
      rows.forEach((r: any) => console.log('[claim-expired] pick', r.id, 'expired_at', r.expires_at, 'status', r.status, 'pools', r.lesspool, r.morepool))
    }
    if (!rows || rows.length === 0) return json(200, { success: true, scanned: 0, claimed: 0, now: nowIso })

    let claimed = 0
    for (const r of rows) {
      try {
        console.log('[claim-expired] marking claiming and invoking claim-fees for pick', r.id)
        // Move to claiming (avoid race)
        await supabase.from('picks').update({ status: 'claiming', last_claim_attempt: new Date().toISOString() }).eq('id', r.id).eq('status', 'open')
        // Call claim-fees
        const resp = await callFunction(CLAIM_FEES_URL, { pickId: r.id })
        console.log('[claim-expired] claim-fees response for pick', r.id, 'status', resp.status, 'ok', resp.ok, 'body', JSON.stringify(resp.data))
        if (resp.ok && resp.data?.success) claimed++
      } catch (_) { /* continue */ }
    }

    return json(200, { success: true, scanned: rows.length, claimed, now: nowIso })
  } catch (e) {
    return json(500, { error: (e as Error)?.message || String(e) })
  }
})

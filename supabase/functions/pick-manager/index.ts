// Supabase Edge Function: pick-manager
// Sweeps for expired picks and flips status from 'open' to 'closed'.
// Can be triggered by scheduled job or opportunistically by the frontend.

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const runId = crypto.randomUUID()
  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const nowIso = new Date().toISOString()
    // Raw logging: request meta (headers sanitized)
    const maskedHeaders = Array.from(req.headers.entries()).reduce((acc: Record<string, string>, [k, v]) => {
      const key = k.toLowerCase()
      acc[key] = (key === 'authorization' || key === 'apikey') ? '[redacted]' : v
      return acc
    }, {})
    const ip = maskedHeaders['x-real-ip'] || maskedHeaders['x-forwarded-for'] || maskedHeaders['cf-connecting-ip'] || 'n/a'
    console.log('[pick-manager]', runId, 'START', { nowIso, ip, headers: maskedHeaders })

    // Count due picks before update
    let dueCount: number | null = null
    try {
      const { count } = await supabase
        .from('picks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .lte('expires_at', nowIso)
      dueCount = (typeof count === 'number') ? count : null
      console.log('[pick-manager]', runId, 'due picks (pre-update):', dueCount)
    } catch (e) {
      console.warn('[pick-manager]', runId, 'failed counting due picks', (e as Error)?.message || String(e))
    }

    // Flip all due picks from open -> closed
    const { data: changed, error: updErr } = await supabase
      .from('picks')
      .update({ status: 'closed', expired_at: nowIso })
      .eq('status', 'open')
      .lte('expires_at', nowIso)
      .select('id')

    if (updErr) throw updErr
    const closedCount = Array.isArray(changed) ? changed.length : 0
    const changedIds = Array.isArray(changed) ? (changed as Array<{ id: string }>).map(r => r.id) : []
    const sample = changedIds.slice(0, 50)
    console.log('[pick-manager]', runId, 'CLOSED', { closedCount, sampleIds: sample, allIdsCount: changedIds.length })
    if (changedIds.length > 50) {
      console.log('[pick-manager]', runId, 'CLOSED_IDS_CONTINUED', changedIds.slice(50))
    }

    // After closing, judge unresolved closed picks (small batch)
    const JUDGE_LIMIT = 10
    const { data: toJudge, error: qErr } = await supabase
      .from('picks')
      .select('id')
      .eq('status', 'closed')
      .is('result', null)
      .lte('expires_at', nowIso)
      .order('expires_at', { ascending: true })
      .limit(JUDGE_LIMIT)
    if (qErr) {
      console.warn('[pick-manager]', runId, 'judge query error', qErr.message)
    }
    const judgeCount = Array.isArray(toJudge) ? toJudge.length : 0
    console.log('[pick-manager]', runId, 'JUDGE_QUEUE', { count: judgeCount })
    let judgedOk = 0
    if (toJudge && toJudge.length > 0) {
      const PRIMARY_JUDGE_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/grok-judge`
      // Hardcoded fallback per user instruction
      const FALLBACK_JUDGE_URL = 'https://fbwzsmpytdjgbjpwkafy.supabase.co/functions/v1/swift-task'
      const FALLBACK_AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZid3pzbXB5dGRqZ2JqcHdrYWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5NjUzNjcsImV4cCI6MjA3MjU0MTM2N30.bWgF_d_gqdTW9kGEqUf9B2Ypy8nBPAjZ1ukk8t660Rk'
      console.log('[pick-manager]', runId, 'JUDGE_URLS', { primary: PRIMARY_JUDGE_URL, fallback: FALLBACK_JUDGE_URL })
      for (const r of toJudge) {
        try {
          console.log('[pick-manager]', runId, 'JUDGE_CALL_START', { pickId: r.id })
          // Try primary grok-judge first (service role auth)
          let resp: Response | null = null
          let bodyText = ''
          try {
            resp = await fetch(PRIMARY_JUDGE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY },
              body: JSON.stringify({ pickId: r.id, reason: 'sweeper' }),
            })
            bodyText = await resp.text()
            console.log('[pick-manager]', runId, 'JUDGE_RESP_PRIMARY', { pickId: r.id, status: resp.status, ok: resp.ok, body_sample: bodyText.slice(0, 300) })
          } catch (e) {
            console.warn('[pick-manager]', runId, 'JUDGE_PRIMARY_ERR', r.id, (e as Error)?.message || String(e))
          }

          if (!resp || resp.status === 404 || !resp.ok) {
            // Fallback: call the provided swift-task endpoint with hardcoded anon token
            console.log('[pick-manager]', runId, 'JUDGE_FALLBACK_CALL', { pickId: r.id, url: FALLBACK_JUDGE_URL })
            try {
              const fbResp = await fetch(FALLBACK_JUDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': FALLBACK_AUTH },
                body: JSON.stringify({
                  name: 'Functions',
                  pickId: r.id,
                  source: 'pick-manager',
                  description: 'pick-manager auto sweep',
                }),
              })
              const fbText = await fbResp.text()
              console.log('[pick-manager]', runId, 'JUDGE_RESP_FALLBACK', { pickId: r.id, status: fbResp.status, ok: fbResp.ok, body_sample: fbText.slice(0, 300) })
              if (fbResp.ok) judgedOk++
            } catch (ee) {
              console.warn('[pick-manager]', runId, 'JUDGE_FALLBACK_ERR', r.id, (ee as Error)?.message || String(ee))
            }
          } else {
            if (resp.ok) judgedOk++
          }
        } catch (e) {
          console.warn('[pick-manager]', runId, 'JUDGE_ERR', r.id, (e as Error)?.message || String(e))
        }
      }
    }

    return json(200, { success: true, runId, closed: closedCount, due: dueCount, judgeQueued: judgeCount, judgeOk: judgedOk, now: nowIso })
  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    console.error('[pick-manager]', runId, 'FATAL', msg)
    return json(500, { error: msg, runId })
  }
})

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const value = Deno.env.get(name) ?? Deno.env.get(name.toLowerCase())
  if (required && (!value || !value.trim())) throw new Error(`Missing env: ${name}`)
  return value?.trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const runId = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
  console.log('[win-loss-totals]', runId, 'START')

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid JSON' })
    const pickId = typeof body.pickId === 'string' ? body.pickId.trim() : ''
    if (!pickId) return json(400, { error: 'pickId required' })

    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: events, error: eventsErr } = await supabase
      .from('win_loss_events')
      .select('user_id, user_wallet')
      .eq('pick_id', pickId)
    if (eventsErr) {
      console.error('[win-loss-totals]', runId, 'EVENT_QUERY_ERROR', eventsErr)
      return json(500, { error: 'Failed to load win/loss events', details: eventsErr.message })
    }
    const affectedUserIds = Array.from(new Set((events || []).map((row) => row.user_id).filter((id): id is string => !!id)))
    if (!affectedUserIds.length) {
      console.log('[win-loss-totals]', runId, 'NO_USERS_TO_UPDATE', { pickId })
      return json(200, { success: true, pickId, usersUpdated: 0 })
    }

    const { data: aggregates, error: aggErr } = await supabase
      .from('win_loss_events')
      .select('user_id, outcome, amount_wei')
      .in('user_id', affectedUserIds)
    if (aggErr) {
      console.error('[win-loss-totals]', runId, 'AGG_QUERY_ERROR', aggErr)
      return json(500, { error: 'Failed to aggregate win/loss totals', details: aggErr.message })
    }

    const totals = new Map<string, { winCount: number; lossCount: number; winAmount: bigint; lossAmount: bigint }>()
    for (const row of aggregates || []) {
      if (!row.user_id) continue
      const amount = BigInt(row.amount_wei || 0)
      const entry = totals.get(row.user_id) || { winCount: 0, lossCount: 0, winAmount: 0n, lossAmount: 0n }
      if (row.outcome === 'win') {
        entry.winCount += 1
        entry.winAmount += amount
      } else if (row.outcome === 'loss') {
        entry.lossCount += 1
        entry.lossAmount += amount
      }
      totals.set(row.user_id, entry)
    }

    for (const [userId, total] of totals.entries()) {
      const { error: updateErr } = await supabase
        .from('users')
        .update({
          win_count: total.winCount,
          loss_count: total.lossCount,
          win_amount_wei: total.winAmount.toString(),
          loss_amount_wei: total.lossAmount.toString(),
        })
        .eq('id', userId)
      if (updateErr) {
        console.error('[win-loss-totals]', runId, 'USER_UPDATE_ERROR', { userId, err: updateErr.message })
      } else {
        console.log('[win-loss-totals]', runId, 'USER_UPDATED', { userId, total })
      }
    }

    return json(200, { success: true, pickId, usersUpdated: totals.size })
  } catch (err) {
    console.error('[win-loss-totals]', runId, 'FATAL', err)
    return json(500, { error: (err as Error)?.message || 'Server error' })
  }
})

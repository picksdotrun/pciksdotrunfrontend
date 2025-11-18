// Supabase Edge Function: log-trade
// Inserts a user trade row and updates pick aggregates (holders/volume per side and totals)

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

type Body = {
  pickId?: string
  userWallet?: string
  side?: 'less' | 'more'
  amountSol?: number
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

    let body: Body
    try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }
    const pickId = body?.pickId?.trim?.() || ''
    const userWallet = body?.userWallet?.trim?.() || ''
    const side = (body?.side || '').toString().toLowerCase() as 'less' | 'more'
    const amountSol = Number(body?.amountSol || 0)
    if (!pickId || !userWallet || (side !== 'less' && side !== 'more') || !(amountSol > 0))
      return json(400, { error: 'pickId, userWallet, side (less|more), amountSol>0 required' })

    // Insert trade
    const { error: insErr } = await supabase.from('user_trades').insert({ pick_id: pickId, user_wallet: userWallet, side, amount_sol: amountSol })
    if (insErr) return json(500, { error: 'Insert trade failed', details: insErr.message })

    // Recompute aggregates
    // Totals by side
    const lessAgg = await supabase
      .from('user_trades')
      .select('user_wallet, amount_sol')
      .eq('pick_id', pickId)
      .eq('side', 'less')
    const moreAgg = await supabase
      .from('user_trades')
      .select('user_wallet, amount_sol')
      .eq('pick_id', pickId)
      .eq('side', 'more')
    if (lessAgg.error || moreAgg.error) return json(500, { error: 'Aggregate query failed' })
    const lessRows = (lessAgg.data || []) as Array<{ user_wallet: string; amount_sol: number }>
    const moreRows = (moreAgg.data || []) as Array<{ user_wallet: string; amount_sol: number }>
    const lessholders = new Set(lessRows.map(r => r.user_wallet)).size
    const moreholders = new Set(moreRows.map(r => r.user_wallet)).size
    const lessvolume = lessRows.reduce((s, r) => s + Number(r.amount_sol || 0), 0)
    const morevolume = moreRows.reduce((s, r) => s + Number(r.amount_sol || 0), 0)
    const holders_total = new Set([...lessRows.map(r => r.user_wallet), ...moreRows.map(r => r.user_wallet)]).size
    const volume_total = lessvolume + morevolume
    const makers_count = holders_total

    const { error: updErr } = await supabase
      .from('picks')
      .update({ lessholders, moreholders, lessvolume, morevolume, holders_total, volume_total, makers_count })
      .eq('id', pickId)
    if (updErr) return json(500, { error: 'Update picks failed', details: updErr.message })

    return json(200, { success: true, pickId, lessholders, moreholders, holders_total, volume_total })
  } catch (e) {
    return json(500, { error: (e as Error)?.message || String(e) })
  }
})


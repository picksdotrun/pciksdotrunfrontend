// Netlify Function: record-prediction
// Records a user's prediction (side + amount) for a pick, keyed by wallet

const { createClient } = require('@supabase/supabase-js')
const { json, verifyAuth } = require('./_lib/auth.cjs')

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
    const supabase = getSupabaseAdmin()
    const v = await verifyAuth(event)
    if (v?.error) return json(401, { error: v.error })
    const walletAddress = v.address

    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }
    const pickId = String(body?.pickId || '').trim()
    const sideRaw = String(body?.side || '').toLowerCase()
    const side = sideRaw === 'less' ? 'less' : (sideRaw === 'more' ? 'more' : null)
    const amountSol = (typeof body?.amountSol === 'number' ? body.amountSol : null)
    const txSignature = String(body?.txSignature || '').trim() || null
    if (!pickId || !side) return json(400, { error: 'pickId and side required' })

    const insert = {
      pick_id: pickId,
      user_wallet: walletAddress || null,
      side,
      amount_sol: amountSol,
    }
    const { data, error } = await supabase.from('user_trades').insert(insert).select('*').maybeSingle()
    if (error) throw error
    return json(200, { success: true, trade: data })
  } catch (e) {
    return json(500, { error: e?.message || 'Server error' })
  }
}

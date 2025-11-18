// Netlify Function: resolve-pick
// Manually resolves a pick by setting win_side/final_value and updating user_predictions

const { createClient } = require('@supabase/supabase-js')

function json(statusCode, body, headers = {}) {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } }
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
    const authKey = event.headers['x-resolve-key'] || event.headers['X-Resolve-Key']
    if (!authKey || authKey !== process.env.RESOLVE_API_KEY) return json(401, { error: 'Unauthorized' })

    const supabase = getSupabaseAdmin()
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }
    const pickId = String(body?.pickId || '').trim()
    const winSideRaw = String(body?.winSide || '').toLowerCase()
    const winSide = ['less','more','void'].includes(winSideRaw) ? winSideRaw : null
    const finalValue = (body?.finalValue == null ? null : String(body.finalValue))
    if (!pickId || !winSide) return json(400, { error: 'pickId and winSide (less|more|void) are required' })

    const patch = { win_side: winSide, final_value: finalValue, resolved_at: new Date().toISOString(), status: 'settled' }
    const { data: pick, error: upErr } = await supabase
      .from('picks')
      .update(patch)
      .eq('id', pickId)
      .select('id, name, line, win_side')
      .maybeSingle()
    if (upErr) throw upErr
    if (!pick) return json(404, { error: 'Pick not found' })

    // Update user_predictions for this pick
    if (winSide === 'void') {
      await supabase.from('user_predictions').update({ status: 'void', result: 'void', resolved_at: new Date().toISOString() }).eq('pick_id', pickId)
    } else {
      await supabase.from('user_predictions').update({ status: 'closed', result: 'won', resolved_at: new Date().toISOString() }).eq('pick_id', pickId).eq('side', winSide)
      await supabase.from('user_predictions').update({ status: 'closed', result: 'lost', resolved_at: new Date().toISOString() }).eq('pick_id', pickId).neq('side', winSide)
    }

    return json(200, { success: true, pick })
  } catch (e) {
    return json(500, { error: e?.message || 'Server error' })
  }
}


// Netlify Function: grok_result (async job poll)

const { createClient } = require('@supabase/supabase-js')

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters?.id
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id is required' }) }
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.storage.from('grok-jobs').download(`${id}.json`)
    if (error || !data) return { statusCode: 404, body: JSON.stringify({ error: 'job not found' }) }
    const buf = Buffer.from(await data.arrayBuffer())
    return { statusCode: 200, body: buf.toString('utf8'), headers: { 'Content-Type': 'application/json' } }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || 'Server error' }) }
  }
}

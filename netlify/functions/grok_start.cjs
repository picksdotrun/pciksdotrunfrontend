// Netlify Function: grok_start (async job starter)
// Creates a job in Netlify Blobs and triggers the background worker.

const fetch = (...args) => globalThis.fetch(...args)
const { createClient } = require('@supabase/supabase-js')

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  try {
    const body = JSON.parse(event.body || '{}')
    const jobId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())
    const now = new Date().toISOString()
    const supabase = getSupabaseAdmin()
    // Ensure bucket exists
    try { await supabase.storage.createBucket('grok-jobs', { public: false }) } catch (_) {}
    await supabase.storage.from('grok-jobs').upload(`${jobId}.json`, Buffer.from(JSON.stringify({ status: 'pending', createdAt: now })), { upsert: true, contentType: 'application/json' })

    // Do not schedule from server (can be blocked by site password). Client will trigger worker with background header.

    return {
      statusCode: 202,
      body: JSON.stringify({ jobId, accepted: true }),
      headers: { 'Content-Type': 'application/json' },
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: e?.message || 'Invalid request' }) }
  }
}

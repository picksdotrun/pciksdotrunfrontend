// Netlify Background Function: grok_worker
// Performs the xAI call and stores the result in Netlify Blobs, keyed by jobId.

const fetch = (...args) => globalThis.fetch(...args)
const { createClient } = require('@supabase/supabase-js')

const XAI_API_KEY = process.env.XAI_API_KEY
const XAI_API_BASE = process.env.XAI_API_BASE || 'https://api.x.ai'
const XAI_DEFAULT_MODEL = process.env.XAI_DEFAULT_MODEL || 'grok-4-latest'

function sanitizeSearchParameters(sp) {
  try {
    if (!sp || typeof sp !== 'object') return sp
    const clone = JSON.parse(JSON.stringify(sp))
    const sources = Array.isArray(clone.sources) ? clone.sources : []
    for (const s of sources) {
      if (Array.isArray(s.allowed_websites) && s.allowed_websites.length > 5) s.allowed_websites = s.allowed_websites.slice(0, 5)
      if (Array.isArray(s.excluded_websites) && s.excluded_websites.length > 5) s.excluded_websites = s.excluded_websites.slice(0, 5)
      if (Array.isArray(s.included_x_handles) && s.included_x_handles.length > 10) s.included_x_handles = s.included_x_handles.slice(0, 10)
      if (Array.isArray(s.excluded_x_handles) && s.excluded_x_handles.length > 10) s.excluded_x_handles = s.excluded_x_handles.slice(0, 10)
    }
    clone.sources = sources
    return clone
  } catch { return sp }
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

exports.handler = async (event) => {
  try {
    if (!XAI_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'XAI_API_KEY missing' }) }
    const { jobId, payload } = JSON.parse(event.body || '{}')
    if (!jobId || !payload) return { statusCode: 400, body: JSON.stringify({ error: 'jobId and payload required' }) }
    const supabase = getSupabaseAdmin()
    try { await supabase.storage.createBucket('grok-jobs', { public: false }) } catch (_) {}
    await supabase.storage.from('grok-jobs').upload(`${jobId}.json`, Buffer.from(JSON.stringify({ status: 'running', startedAt: new Date().toISOString() })), { upsert: true, contentType: 'application/json' })

    // Build request
    const messages = Array.isArray(payload.messages) ? payload.messages : []
    const modelIn = (typeof payload.model === 'string' && payload.model.trim()) || null
    const selectedModel = modelIn || XAI_DEFAULT_MODEL
    const search_parameters = sanitizeSearchParameters(payload.search_parameters || {
      mode: 'on',
      return_citations: true,
      max_search_results: 10,
      sources: [
        { type: 'web', allowed_websites: ['nfl.com', 'espn.com', 'pro-football-reference.com'] },
        { type: 'news' },
      ],
    })
    const url = `${XAI_API_BASE.replace(/\/$/, '')}/v1/chat/completions`
    const req = {
      model: selectedModel,
      messages,
      temperature: payload.temperature ?? 0.2,
      max_tokens: payload.max_tokens ?? 320,
      ...(payload.top_p != null ? { top_p: payload.top_p } : {}),
      ...(payload.stop != null ? { stop: payload.stop } : {}),
      ...(payload.presence_penalty != null ? { presence_penalty: payload.presence_penalty } : {}),
      ...(payload.frequency_penalty != null ? { frequency_penalty: payload.frequency_penalty } : {}),
      search_parameters,
      ...(Array.isArray(payload.tools) ? { tools: payload.tools } : {}),
      ...(payload.tool_choice ? { tool_choice: payload.tool_choice } : {}),
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text
      try { detail = JSON.parse(text) } catch {}
      await supabase.storage.from('grok-jobs').upload(`${jobId}.json`, Buffer.from(JSON.stringify({ status: 'error', error: 'xai_error', detail, finishedAt: new Date().toISOString() })), { upsert: true, contentType: 'application/json' })
      return { statusCode: 202, body: JSON.stringify({ accepted: true }) }
    }
    let data
    try { data = JSON.parse(text) } catch { data = { rawText: text } }
    const msg = data?.choices?.[0]?.message || {}
    let toolCalls = null
    try {
      const tcs = msg?.tool_calls || []
      if (Array.isArray(tcs) && tcs.length) {
        toolCalls = tcs.map(tc => ({
          id: tc?.id,
          type: tc?.type,
          function: {
            name: tc?.function?.name,
            arguments: (() => { try { return JSON.parse(tc?.function?.arguments || '{}') } catch { return tc?.function?.arguments } })(),
          },
        }))
      }
    } catch {}
    const result = {
      status: 'done',
      content: msg?.content ?? '',
      modelUsed: data?.model || selectedModel,
      citations: data?.citations || msg?.citations || null,
      usage: data?.usage || null,
      toolCalls,
      raw: data,
      finishedAt: new Date().toISOString(),
    }
    await supabase.storage.from('grok-jobs').upload(`${jobId}.json`, Buffer.from(JSON.stringify(result)), { upsert: true, contentType: 'application/json' })
    return { statusCode: 202, body: JSON.stringify({ accepted: true }) }
  } catch (e) {
    try {
      const supabase = getSupabaseAdmin()
      const jobId = (() => { try { return JSON.parse(event.body || '{}')?.jobId } catch { return null } })()
      if (jobId) await supabase.storage.from('grok-jobs').upload(`${jobId}.json`, Buffer.from(JSON.stringify({ status: 'error', error: e?.message || 'worker_error', finishedAt: new Date().toISOString() })), { upsert: true, contentType: 'application/json' })
    } catch {}
    return { statusCode: 202, body: JSON.stringify({ accepted: true }) }
  }
}

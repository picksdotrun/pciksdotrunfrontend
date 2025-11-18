// Netlify Function: grok (xAI chat proxy)
// Securely proxies chat requests to xAI (Grok) API so the client never sees the secret key.

// Prefer native fetch from Node 18/20 runtime used by Netlify Functions
const fetch = (...args) => globalThis.fetch(...args)

const XAI_API_KEY = process.env.XAI_API_KEY
const XAI_API_BASE = process.env.XAI_API_BASE || 'https://api.x.ai'
const XAI_DEFAULT_MODEL = process.env.XAI_DEFAULT_MODEL || 'grok-beta'

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

exports.handler = async (event) => {
  // Lightweight health check (does not hit xAI)
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {}
    if (q.health === '1') {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, hasKey: Boolean(XAI_API_KEY), model: XAI_DEFAULT_MODEL }),
      }
    }
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  try {
    if (!XAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured: XAI_API_KEY missing' }) }
    }

    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || ''
    if (!contentType.includes('application/json')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Content-Type must be application/json' }) }
    }

    const body = JSON.parse(event.body || '{}')
    const {
      messages = [],
      model,
      temperature = 0.7,
      max_tokens,
      top_p,
      stop,
      presence_penalty,
      frequency_penalty,
      search_parameters,
      tools,
      tool_choice,
      // stream is intentionally ignored in this basic foundation
    } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'messages[] is required' }) }
    }

    const selectedModel = (typeof model === 'string' && model.trim()) || XAI_DEFAULT_MODEL
    const url = `${XAI_API_BASE.replace(/\/$/, '')}/v1/chat/completions`
    const spRaw = (search_parameters && typeof search_parameters === 'object')
      ? search_parameters
      : {
          mode: 'on',
          return_citations: true,
          max_search_results: 10,
          sources: [
            { type: 'web', allowed_websites: ['nfl.com', 'espn.com', 'pro-football-reference.com'] },
            { type: 'news' },
          ],
        }
    const sp = sanitizeSearchParameters(spRaw)
    const payload = {
      model: selectedModel,
      messages,
      temperature,
      ...(max_tokens != null ? { max_tokens } : {}),
      ...(top_p != null ? { top_p } : {}),
      ...(stop != null ? { stop } : {}),
      ...(presence_penalty != null ? { presence_penalty } : {}),
      ...(frequency_penalty != null ? { frequency_penalty } : {}),
      search_parameters: sp,
      ...(Array.isArray(tools) ? { tools } : {}),
      ...(tool_choice ? { tool_choice } : {}),
    }
    if (payload.max_tokens == null) {
      payload.max_tokens = 320 // default cap to speed up slower calls
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const text = await res.text()
    if (!res.ok) {
      // Bubble up xAI error when possible
      try {
        const errJson = JSON.parse(text)
        return { statusCode: res.status, body: JSON.stringify({ error: 'xai_error', detail: errJson }) }
      } catch (_) {
        return { statusCode: res.status, body: JSON.stringify({ error: 'xai_error', detail: text }) }
      }
    }

    // Expect OpenAI-compatible response shape
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'invalid_json_from_xai', detail: text }) }
    }

    // Optionally normalize to a minimal shape for the client
    const msg = data?.choices?.[0]?.message || {}
    const content = msg?.content ?? ''
    const modelUsed = data?.model || selectedModel
    const citations = data?.citations || msg?.citations || null
    const usage = data?.usage || null
    // Normalize tool calls if present
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
    return {
      statusCode: 200,
      body: JSON.stringify({ content, raw: data, modelUsed, citations, usage, toolCalls }),
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || 'Unknown error' }) }
  }
}

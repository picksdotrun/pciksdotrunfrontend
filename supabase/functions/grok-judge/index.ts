// Supabase Edge Function: grok-judge
// Given a pickId, use xAI (Grok) with agentic web/x search to determine
// whether the outcome was LESS or MORE than the posted line.
// Writes the verdict into the database (result, moderation_description, etc.).

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null

// Cold start marker for visibility in logs
console.log('[grok-judge] BOOT')

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DEFAULT_BACKEND_BASE = 'https://picksbackend-production.up.railway.app'
const STRICT_YES_NO_DIRECTIVE =
  'Final directive: Regardless of whether sources describe outcomes as over/under, more/less, or any other phrasing, you must convert your conclusion into the literal string "yes" or "no" (lowercase) in the JSON result. Never emit other result values; if evidence is inconclusive, choose the best-supported yes/no answer.'

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

async function postJson(url: string, payload: any, headers: Record<string, string>) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data, text }
}

function maskHeaders(h: Headers): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const [k, v] of h.entries()) {
    const key = k.toLowerCase()
    masked[key] = (key === 'authorization' || key === 'apikey') ? '[redacted]' : v
  }
  return masked
}

function buildSystemText(): string {
  return [
    'You are a prediction market moderation AI.',
    'Decide if the observed outcome was LESS or MORE than a posted line.',
    'Use web_search and x_search tools to verify final stats (with sources).',
    'Return ONLY one JSON object exactly: {"result":"less|more|void","confidence":0..1,"reason":"short"}.',
    'If there is insufficient evidence or conflicting sources, use result:"void".',
    'Map: under => less, over => more. Respond with strict JSON only (no extra text).',
    STRICT_YES_NO_DIRECTIVE,
  ].join('\n')
}

function buildUserText(pick: any): string {
  const name = pick?.name || ''
  const category = pick?.category || ''
  const line = pick?.line || ''
  const team = pick?.team || ''
  const desc = pick?.description || ''
  const createdAt = pick?.created_at || ''
  const expiresAt = pick?.expires_at || ''
  const facts = {
    prediction: name,
    category,
    line,
    team,
    description: desc,
    window_utc: { from: createdAt, to: expiresAt },
  }
  return `Determine the final outcome for this prediction. Use tools to verify. Facts: ${JSON.stringify(facts)}\n${STRICT_YES_NO_DIRECTIVE}`
}

function buildPromptSystem() {
  return [
    {
      role: 'system',
      content: [
        { type: 'text', text: [
          'You are a prediction market moderation AI.',
          'Your task: Decide if the observed outcome was LESS or MORE than a posted line.',
          'You MUST use available tools (web_search, x_search) to verify final stats.',
          'Return ONLY one JSON object with keys exactly: {"result":"less|more|void","confidence":0..1,"reason":"short"}.',
          'If there is insufficient evidence or conflicting sources, use result:"void".',
          'Map: under => less, over => more. Keep response strictly JSON without extra text.',
          STRICT_YES_NO_DIRECTIVE,
        ].join('\n') },
      ],
    },
  ]
}

function buildPromptUser(pick: any) {
  const name = pick?.name || ''
  const category = pick?.category || ''
  const line = pick?.line || ''
  const team = pick?.team || ''
  const desc = pick?.description || ''
  const createdAt = pick?.created_at || ''
  const expiresAt = pick?.expires_at || ''
  // Compose concise, structured facts for reproducibility.
  const facts = {
    prediction: name,
    category,
    line,
    team,
    description: desc,
    window_utc: { from: createdAt, to: expiresAt },
  }
  return [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Determine outcome for this prediction. Use tools to verify. Facts: ${JSON.stringify(facts)}\n${STRICT_YES_NO_DIRECTIVE}`,
      },
    ],
  }]
}

function normalizeBinaryResult(value: unknown): 'yes' | 'no' | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'yes' || raw === 'no') return raw
  return null
}

function extractJsonCandidate(text: string): any | null {
  // Try to extract a JSON object from response content (may include prose)
  const fence = text.match(/```json\s*([\s\S]*?)\s*```/i)
  const raw = fence ? fence[1] : text
  try {
    const parsed = JSON.parse(raw)
    const normalized = normalizeBinaryResult(parsed?.result)
    if (!normalized) return null
    return { ...parsed, result: normalized }
  } catch { /* noop */ }
  // Fallback: detect plain yes/no text
  const t = text.trim().toLowerCase()
  if (t === 'yes' || t === '"yes"') return { result: 'yes', reason: 'text', confidence: 0.5 }
  if (t === 'no' || t === '"no"') return { result: 'no', reason: 'text', confidence: 0.5 }
  return null
}

async function triggerBackendResolve(pick: any, result: string, pickId: string) {
  const addr = (pick?.evm_market_address || '').toString().trim()
  const marketType = (pick?.evm_market_type || '').toString().toLowerCase()
  if (!addr) return { skipped: 'no_market' }
  if (marketType && marketType !== 'native_bnb') return { skipped: 'unsupported_market_type', marketType }
  const backendBase = getEnv('EVM_RESOLVE_BACKEND_URL') || DEFAULT_BACKEND_BASE
  if (!backendBase) return { skipped: 'no_backend_url' }
  const endpoint = `${backendBase.replace(/\/$/, '')}/api/resolve-market`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const resolveKey = getEnv('EVM_RESOLVE_BACKEND_KEY')
  if (resolveKey) headers['x-resolve-key'] = resolveKey
  const payload = { pickId: pickId || pick?.id || null, marketAddress: addr, result }
  try {
    const resp = await postJson(endpoint, payload, headers)
    return { endpoint, status: resp.status, ok: resp.ok, data: resp.data }
  } catch (err) {
    const message = (err as Error)?.message || String(err)
    return { endpoint, error: message }
  }
}

async function triggerWinLossTracker(supabaseUrl: string, serviceKey: string, pickId: string) {
  if (!supabaseUrl || !serviceKey || !pickId) return { skipped: true }
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/win-loss-tracker`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ pickId }),
    })
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
    return { status: res.status, ok: res.ok, body: data }
  } catch (err) {
    return { error: (err as Error)?.message || String(err) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const runId = crypto.randomUUID()
  const headersMasked = maskHeaders(req.headers)
  const ip = headersMasked['x-real-ip'] || headersMasked['x-forwarded-for'] || headersMasked['cf-connecting-ip'] || 'n/a'
  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const XAI_API_KEY = getEnv('XAI_API_KEY', true)!
    const DEFAULT_XAI_MODEL = 'grok-4-fast'
    const DEFAULT_XAI_TIMEOUT_MS = 60000
    const XAI_MODEL = getEnv('XAI_MODEL') || DEFAULT_XAI_MODEL
    const XAI_TIMEOUT_MS = Number(getEnv('XAI_TIMEOUT_MS') || String(DEFAULT_XAI_TIMEOUT_MS))

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    let body: any
    try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON' }) }
    const pickId = (body?.pickId || '').toString().trim()
    if (!pickId) return json(400, { error: 'pickId required' })

    console.log('[grok-judge]', runId, 'START', { ip, pickId, headers: headersMasked, model: XAI_MODEL })

    // If result already exists, exit idempotently
    const { data: current, error: currErr } = await supabase
      .from('picks')
      .select('id, name, category, line, description, team, created_at, expires_at, result, evm_market_address, evm_market_type')
      .eq('id', pickId)
      .single()
    if (currErr || !current) return json(404, { error: 'Pick not found' })
    if (current.result) {
      console.log('[grok-judge]', runId, 'ALREADY_SET', { pickId, result: current.result })
      return json(200, { success: true, already: true, result: current.result })
    }

    // Build request for xAI Responses API with tools (Responses API expects role+content strings)
    const grokPayload = {
      model: XAI_MODEL,
      input: [
        { role: 'system', content: buildSystemText() },
        { role: 'user', content: buildUserText(current) },
      ],
      tools: [ { type: 'web_search' }, { type: 'x_search' } ],
    }
    const grokHeaders = { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' }
    console.log('[grok-judge]', runId, 'REQUEST', { endpoint: 'https://api.x.ai/v1/responses', payloadKeys: Object.keys(grokPayload) })

    // Timeboxed request
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('timeout'), XAI_TIMEOUT_MS)
    let grokRes
    try {
      grokRes = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: grokHeaders,
        body: JSON.stringify(grokPayload),
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timeout)
      const msg = (e as Error)?.message || String(e)
      console.error('[grok-judge]', runId, 'HTTP_ERROR', msg)
      return json(502, { error: 'Grok request failed', details: msg })
    } finally {
      clearTimeout(timeout)
    }

    const grokText = await grokRes.text()
    let grokJson: any = null
    try { grokJson = JSON.parse(grokText) } catch { /* may be plain text */ }
    // Responses API: try output_text first, then aggregate any text segments from output[].content[].text
    let outputText: string | null = null
    if (grokJson && typeof grokJson === 'object') {
      if (typeof grokJson.output_text === 'string') outputText = grokJson.output_text
      else if (Array.isArray(grokJson.output)) {
        try {
          for (const item of grokJson.output) {
            const content = item?.content
            if (Array.isArray(content)) {
              for (const c of content) {
                if (typeof c?.text === 'string') outputText = (outputText || '') + c.text
              }
            }
          }
        } catch {}
      }
    }
    const citations = grokJson?.citations || []
    console.log('[grok-judge]', runId, 'RESPONSE', { status: grokRes.status, ok: grokRes.ok, hasJson: !!grokJson, citations_count: Array.isArray(citations) ? citations.length : 0 })
    // Raw response visibility (truncated): full body and extracted output_text
    try {
      const bodySample = (typeof grokText === 'string' ? grokText : String(grokText)).slice(0, 2000)
      const textSample = (outputText || '').slice(0, 1000)
      console.log('[grok-judge]', runId, 'RAW_BODY_SAMPLE', { sample: bodySample })
      console.log('[grok-judge]', runId, 'RAW_TEXT_SAMPLE', { sample: textSample })
    } catch (_) {}

    const rawContent = outputText || (typeof grokText === 'string' ? grokText : '')
    // Extract strict JSON verdict
    const parsed = extractJsonCandidate(rawContent)
    if (!parsed || !parsed.result || !['yes','no'].includes(String(parsed.result).toLowerCase())) {
      console.warn('[grok-judge]', runId, 'PARSE_FAIL', { raw_sample: rawContent.slice(0, 280) })
      return json(422, { error: 'Unable to parse Grok verdict', raw: rawContent || grokText })
    }
    const result = String(parsed.result).toLowerCase()
    const reason = (parsed.reason || '').toString().slice(0, 1000)
    const confidence = Number(parsed.confidence)

    // Persist (idempotent: only if still null)
    const update = {
      result,
      moderation_description: reason,
      result_confidence: Number.isFinite(confidence) ? confidence : null,
      result_citations: Array.isArray(citations) ? citations : null,
      result_model: XAI_MODEL,
      resolved_at: new Date().toISOString(),
      win_side: result, // optional alignment
    }
    const { error: upErr } = await supabase.from('picks').update(update).eq('id', pickId).is('result', null)
    if (upErr) {
      console.error('[grok-judge]', runId, 'DB_UPDATE_ERROR', upErr.message)
      return json(500, { error: 'DB update failed', details: upErr.message })
    }
    const evmInfo = await triggerBackendResolve(current, result, pickId)
    const winLossInfo = await triggerWinLossTracker(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, pickId)
    console.log('[grok-judge]', runId, 'DONE', { pickId, result, reason_len: reason.length, citations: Array.isArray(citations) ? citations.length : 0, evm: evmInfo, winLoss: winLossInfo })
    return json(200, { success: true, pickId, result })
  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    console.error('[grok-judge]', runId, 'FATAL', msg)
    return json(500, { error: msg })
  }
})

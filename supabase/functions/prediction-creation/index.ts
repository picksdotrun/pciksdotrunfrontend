// Supabase Edge Function: prediction-creation
// Uses Grok (xAI) to draft structured prediction details from a user description.

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const value = Deno.env.get(name)
  if (required && (!value || !value.trim())) throw new Error(`Missing env: ${name}`)
  return value?.trim()
}

const DURATION_CHOICES = [60, 300, 600, 1200, 1800, 3600, 7200, 14400, 28800, 43200, 86400, 172800, 259200, 604800] as const
const CATEGORY_OPTIONS = ['Politics','Sports','Culture','Crypto','Climate','Economics','Mentions','Companies','Financials','Tech & Science','Health','World'] as const
const DEFAULT_CATEGORY = 'Sports'

function normalizeCategory(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CATEGORY
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_CATEGORY
  const match = CATEGORY_OPTIONS.find((option) => option.toLowerCase() === trimmed.toLowerCase())
  return match || DEFAULT_CATEGORY
}

function clampString(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function coerceDuration(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num)
}

function buildSystemPrompt() {
  return [
    'You are a prediction market creation assistant. Convert every idea into a binary YES / NO market.',
    'Always follow these rules:',
    '1. Rewrite the idea as a YES-or-NO question with a measurable threshold when needed. Example: "How many touchdowns..." → "Will Patrick Mahomes throw more than 3 touchdowns in his next game?"',
    '2. Create concise outcomes: the YES outcome MUST begin with "Yes " and the NO outcome MUST begin with "No ". Keep wording mirrored, specific, and free of "over/under" phrasing.',
    '3. Provide a short market name (<=30 chars) and a concise description (<=200 chars) that reiterates the YES/NO framing.',
    '4. Supply a short numeric or categorical line (<=15 chars) when useful (e.g., "3 TDs", "25 bps") and a matching category label (<=22 chars) such as "Touchdowns", "bps", "%", or "Win/Loss".',
    '5. Assign each market to exactly one of these categories and include it verbatim in the JSON: Politics, Sports, Culture, Crypto, Climate, Economics, Mentions, Companies, Financials, Tech & Science, Health, World.',
    '6. Select a realistic expiration duration in seconds from {60,300,600,1200,1800,3600,7200,14400,28800,43200,86400,172800,259200,604800} that fits the event timeline.',
    '7. Keep the description concise (<=160 characters) while summarizing the YES/NO framing.',
    '8. Estimate the probability (0-100) that the YES outcome resolves true and return it as "yes_probability".',
    'Return ONLY JSON with the exact keys: {"name","description","line","category","yes_label","yes_value","no_label","no_value","duration_sec","yes_probability"}.',
    'Keep language clean, declarative, and confident.'
  ].join('\n')
}

function buildUserPrompt(description: string) {
  return [
    `User idea: "${description}"`,
    'Rephrase it into a YES/NO market that follows the system rules.',
    'Provide clear outcomes for the YES and NO sides, including any numeric cutoffs.',
    'Pick an expiration duration (in seconds) from the allowed list that fits the event timing.',
    'Respond with JSON only and include the chosen category from the approved list.'
  ].join('\n')
}

function extractResponseText(payload: any): string {
  if (!payload) return ''
  if (typeof payload.output_text === 'string') return payload.output_text
  if (Array.isArray(payload.output)) {
    const segments: string[] = []
    for (const item of payload.output) {
      if (Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (part?.type === 'output_text' && typeof part?.text === 'string') segments.push(part.text)
        }
      }
    }
    if (segments.length) return segments.join('\n')
  }
  if (typeof payload === 'string') return payload
  return ''
}

function parseSuggestion(raw: string) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.warn('[prediction-creation] JSON parse failed', { sample: raw.slice(0, 280) })
    return null
  }
}

function toSuggestion(candidate: any, fallbackDescription: string) {
  const suggestion: Record<string, unknown> = {}
  if (candidate && typeof candidate === 'object') Object.assign(suggestion, candidate)
  if (!suggestion.name) suggestion.name = fallbackDescription.slice(0, 30) || 'New Prediction'
  if (!suggestion.description) suggestion.description = fallbackDescription.slice(0, 200)
  if (!suggestion.line) suggestion.line = '0.0'
  if (!suggestion.category) suggestion.category = DEFAULT_CATEGORY
  if (!suggestion.yes_label) suggestion.yes_label = 'Yes outcome'
  if (!suggestion.yes_value) suggestion.yes_value = ''
  if (!suggestion.no_label) suggestion.no_label = 'No outcome'
  if (!suggestion.no_value) suggestion.no_value = ''
  if (!suggestion.duration_sec) suggestion.duration_sec = inferDurationFromText(fallbackDescription)
  if (suggestion.yes_probability == null) suggestion.yes_probability = 50
  return suggestion
}

function ensurePrefix(value: string | null, prefix: 'Yes' | 'No') {
  if (!value) return prefix === 'Yes' ? 'Yes outcome' : 'No outcome'
  const trimmed = value.trim()
  if (!trimmed) return prefix === 'Yes' ? 'Yes outcome' : 'No outcome'
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed.replace(/\s+/g, ' ')
  return `${prefix} ${trimmed.replace(/^yes\s+/i, '').replace(/^no\s+/i, '').trim()}`
}

function inferDurationFromText(text: string): number {
  const lower = text.toLowerCase()
  if (/\bnext (hour|couple of hours)\b/.test(lower)) return 3600
  if (/\btoday\b|\btonight\b|\bthis (afternoon|evening|morning)\b/.test(lower)) return 43200
  if (/\btomorrow\b|\bnext day\b/.test(lower)) return 86400
  if (/\bthis week\b|\bnext week\b|\bweek\b/.test(lower)) return 604800
  if (/\bthis month\b|\bnext month\b|\b(december|november|january|february|march|april|may|june|july|august|september|october)\b/.test(lower)) return 604800
  if (/\bseason\b|\bplayoffs\b|\byear\b/.test(lower)) return 604800
  return 86400
}

function normalizeDuration(value: unknown, fallbackDescription: string): number {
  const candidate = coerceDuration(value)
  if (candidate && DURATION_CHOICES.includes(candidate as any)) return candidate
  const inferred = inferDurationFromText(fallbackDescription)
  if (DURATION_CHOICES.includes(inferred as any)) return inferred
  return 86400
}

function normalizeSuggestionFields(suggestion: Record<string, unknown>, fallbackDescription: string) {
  suggestion.yes_label = ensurePrefix(clampString(suggestion.yes_label, 70), 'Yes')
  suggestion.no_label = ensurePrefix(clampString(suggestion.no_label, 70), 'No')
  suggestion.yes_value = clampString(suggestion.yes_value, 24) || ''
  suggestion.no_value = clampString(suggestion.no_value, 24) || ''
  suggestion.duration_sec = normalizeDuration(suggestion.duration_sec, fallbackDescription)
  const yesProbability = Number(String(suggestion.yes_probability ?? '').replace(/[^0-9.]/g, ''))
  suggestion.yes_probability = Number.isFinite(yesProbability) ? Math.min(100, Math.max(0, yesProbability)) : 50
  suggestion.name = clampString(suggestion.name, 30) || 'New Prediction'
  suggestion.description = clampString(suggestion.description, 160) || fallbackDescription.slice(0, 160)
  suggestion.line = clampString(suggestion.line, 15) || '0.0'
  suggestion.category = normalizeCategory(suggestion.category)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  let body: any
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const description = clampString(body?.description, 600)
  if (!description) return json(400, { error: 'description is required' })

  const requestId = crypto.randomUUID()
  console.log('[prediction-creation]', requestId, 'START', { description_sample: description.slice(0, 160) })

  try {
    const XAI_API_KEY = getEnv('XAI_API_KEY', true)!
    const model = getEnv('XAI_MODEL') || 'grok-4-fast'
    const timeoutMs = Number(getEnv('XAI_TIMEOUT_MS') || '60000')

    const payload = {
      model,
      input: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(description) },
      ],
      temperature: 0.4,
    }
    console.log('[prediction-creation]', requestId, 'REQUEST', { model, timeoutMs })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
    let response: Response
    try {
      response = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${XAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const text = await response.text()
    console.log('[prediction-creation]', requestId, 'RESPONSE_STATUS', { status: response.status, ok: response.ok })
    console.log('[prediction-creation]', requestId, 'RAW_BODY', text.slice(0, 2000))
    if (!response.ok) {
      console.error('[prediction-creation]', requestId, 'GROK_ERROR', { status: response.status })
      return json(response.status, { error: 'Failed to draft prediction', details: text.slice(0, 2000) })
    }

    let parsedPayload: any = null
    try { parsedPayload = JSON.parse(text) } catch {
      parsedPayload = text
    }
    const rawContent = typeof parsedPayload === 'string' ? parsedPayload : extractResponseText(parsedPayload)
    console.log('[prediction-creation]', requestId, 'PARSED_TEXT_SAMPLE', rawContent.slice(0, 2000))
    const candidate = parseSuggestion(rawContent)
    const suggestion = toSuggestion(candidate, description)
    normalizeSuggestionFields(suggestion, description)

    const result = {
      name: suggestion.name,
      description: suggestion.description,
      line: suggestion.line,
      category: suggestion.category,
      yes_label: suggestion.yes_label,
      yes_value: suggestion.yes_value,
      no_label: suggestion.no_label,
      no_value: suggestion.no_value,
      duration_sec: Number(suggestion.duration_sec) || 3600,
      yes_probability: Number(suggestion.yes_probability) || 50,
    }

    console.log('[prediction-creation]', requestId, 'SUCCESS', result)
    return json(200, { success: true, suggestion: result })
  } catch (err) {
    const message = (err as Error)?.message || String(err)
    console.error('[prediction-creation]', requestId, 'FATAL', message)
    return json(500, { error: 'prediction_creation_failed', details: message })
  }
})

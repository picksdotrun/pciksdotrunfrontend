// Grok (xAI) client – frontend side
// Calls our Netlify function proxy so the API key stays server-side.

const FN_PATH = import.meta.env.VITE_GROK_FUNCTION_PATH || '/.netlify/functions/grok'

export async function chatWithGrok({ messages, model, temperature, max_tokens, top_p, stop, presence_penalty, frequency_penalty, search_parameters, tools, tool_choice } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages[] is required')
  }
  const body = { messages }
  if (typeof model === 'string' && model.trim()) body.model = model.trim()
  if (temperature != null) body.temperature = temperature
  if (max_tokens != null) body.max_tokens = max_tokens
  if (top_p != null) body.top_p = top_p
  if (stop != null && !(Array.isArray(stop) && stop.length === 0)) body.stop = stop
  if (presence_penalty != null) body.presence_penalty = presence_penalty
  if (frequency_penalty != null) body.frequency_penalty = frequency_penalty
  if (search_parameters && typeof search_parameters === 'object') body.search_parameters = search_parameters
  if (Array.isArray(tools)) body.tools = tools
  if (tool_choice != null) body.tool_choice = tool_choice

  async function attempt(n, delayMs) {
    const res = await fetch(FN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      // Retry on transient/server errors
      if (n > 0 && (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise(r => setTimeout(r, delayMs))
        return attempt(n - 1, delayMs * 1.5)
      }
      try {
        const err = JSON.parse(text)
        throw new Error(err?.detail?.error?.message || err?.detail?.message || err?.error || 'Grok proxy error')
      } catch {
        throw new Error(text || 'Grok proxy error')
      }
    }
    return JSON.parse(text)
  }
  const data = await attempt(1, 600) // one retry with small backoff
  return data // { content, raw }
}

export function toUser(content) {
  return { role: 'user', content: String(content ?? '') }
}

export function toAssistant(content) {
  return { role: 'assistant', content: String(content ?? '') }
}

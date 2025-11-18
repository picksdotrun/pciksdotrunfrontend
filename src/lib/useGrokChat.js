import { useCallback, useMemo, useState } from 'react'
import { chatWithGrok } from './grok'

// Simple chat hook for Grok via Netlify function
export default function useGrokChat(options = {}) {
  const [messages, setMessages] = useState(options.initialMessages || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastRaw, setLastRaw] = useState(null)
  const [lastToolCalls, setLastToolCalls] = useState(null)

  const canSend = useMemo(() => !loading, [loading])

  const send = useCallback(async (contentOrMessage, extra = {}) => {
    setError(null)
    const isBatch = Array.isArray(contentOrMessage)
    const toMsgs = () => {
      if (isBatch) return contentOrMessage
      return (typeof contentOrMessage === 'string')
        ? [{ role: 'user', content: contentOrMessage }]
        : [contentOrMessage]
    }
    const batch = toMsgs()
    const next = [...messages, ...batch]
    setMessages(next)
    setLoading(true)
    try {
      const { content, raw, toolCalls } = await chatWithGrok({
        messages: next,
        model: options.model,
        temperature: options.temperature,
        ...extra,
      })
      setLastRaw(raw ?? null)
      setLastToolCalls(toolCalls ?? null)
      const assistant = { role: 'assistant', content: content || '' }
      setMessages(prev => [...prev, assistant])
      return assistant
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [messages, options.model, options.temperature])

  const reset = useCallback(() => {
    setMessages([])
    setError(null)
    setLastRaw(null)
    setLastToolCalls(null)
  }, [])

  return { messages, loading, error, canSend, send, reset, lastRaw, lastToolCalls }
}

import { useState } from 'react'
import useGrokChat from '../lib/useGrokChat'

export default function GrokChatBox() {
  const [input, setInput] = useState('')
  const { messages, loading, error, send, reset } = useGrokChat({
    model: undefined, // use server default
    temperature: 0.7,
  })

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim()) return
    const text = input
    setInput('')
    await send(text)
  }

  return (
    <div className="w-full max-w-xl mx-auto p-4 border border-card-border rounded-md bg-card-bg shadow-lg shadow-black/40">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-white">Grok Chat (xAI)</h3>
        <button
          className="text-xs text-gray-secondary hover:text-white transition-colors"
          onClick={reset}
          disabled={loading}
        >
          Reset
        </button>
      </div>

      <div className="space-y-2 max-h-64 overflow-auto mb-3">
        {messages.length === 0 && (
          <div className="text-sm text-gray-secondary">Start a conversation with Grok…</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'assistant' ? 'text-white' : 'text-gray-300'}>
            <span className="font-medium mr-2 text-gray-secondary">{m.role === 'assistant' ? 'Grok:' : 'You:'}</span>
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}
        {loading && <div className="text-sm text-gray-secondary">Thinking…</div>}
        {error && <div className="text-sm text-red-400">{String(error.message || error)}</div>}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          className="flex-1 border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright focus:ring-1 focus:ring-green-bright/40"
          placeholder="Ask anything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button
          className="bg-green-bright text-dark-bg rounded px-4 py-2 disabled:opacity-50 font-semibold hover:opacity-90 transition-opacity"
          type="submit"
          disabled={loading}
        >
          Send
        </button>
      </form>
    </div>
  )
}

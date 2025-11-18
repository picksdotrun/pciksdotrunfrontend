import { useMemo, useState } from 'react'
import Header from './Header'
import Footer from './Footer'
import useGrokJob from '../lib/useGrokJob'

const reportUfcTool = {
  type: 'function',
  function: {
    name: 'report_ufc_prop',
    description: 'Return a single structured numeric UFC fight metric with metadata and citations.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sport: { type: 'string', enum: ['ufc'] },
        fighter: { type: 'string', description: 'Fighter full name' },
        opponent: { type: 'string', description: 'Opponent full name (if known)' },
        prop: { type: 'string', enum: [
          'significant_strikes_landed',
          'total_strikes_landed',
          'takedowns_landed',
          'takedown_attempts',
          'control_time_seconds',
          'knockdowns',
          'submission_attempts',
        ] },
        scope: { type: 'string', enum: ['last_fight', 'on_date'] },
        date: { type: 'string', description: 'YYYY-MM-DD if scope=on_date' },
        value: { type: 'number', description: 'Numeric result for the metric' },
        units: { type: 'string', description: 'e.g., sig_str, total_str, td, sec, kd, sub_att' },
        fight: {
          type: 'object',
          additionalProperties: false,
          properties: {
            date: { type: 'string' },
            event: { type: 'string' },
            opponent: { type: 'string' },
            weight_class: { type: 'string' },
            rounds: { type: 'number' },
            method: { type: 'string' },
            method_detail: { type: 'string' },
            time_in_round: { type: 'string' },
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        sources: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        query_time: { type: 'string' },
      },
      required: ['sport', 'fighter', 'prop', 'value', 'units'],
    },
  },
}

export default function AdminUFC() {
  const [fighter, setFighter] = useState('Conor McGregor')
  const [opponent, setOpponent] = useState('')
  const [prop, setProp] = useState('significant_strikes_landed')
  const [scope, setScope] = useState('last_fight')
  const [date, setDate] = useState('')
  const [freePrompt, setFreePrompt] = useState('')

  const { status, error, start, reset, result } = useGrokJob()

  const searchParams = useMemo(() => ({
    mode: 'on',
    return_citations: true,
    max_search_results: 10,
    sources: [
      { type: 'web', allowed_websites: ['ufcstats.com', 'espn.com', 'sherdog.com', 'mmajunkie.usatoday.com', 'tapology.com'] },
      { type: 'news' },
    ],
  }), [])

  const toUserPrompt = () => {
    if (freePrompt.trim()) return freePrompt.trim()
    const base = `Provide the ${prop.replaceAll('_', ' ')} for ${fighter}${opponent ? ` vs ${opponent}` : ''} in the ${scope.replace('_', ' ')}.`
    const extra = scope === 'on_date' && date ? ` The fight date is ${date}.` : ''
    return base + extra + ' Return the metric via the report_ufc_prop tool with the correct numeric value, units, and metadata.'
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const system = {
      role: 'system',
      content: 'You are a UFC stats agent. Use the report_ufc_prop tool to return a single structured numeric result with metadata. Cite authoritative sources (UFCStats, ESPN, Sherdog, Tapology). Prefer tool calls over prose.',
    }
    const user = { role: 'user', content: toUserPrompt() }
    const context = { role: 'user', content: JSON.stringify({ sport: 'ufc', fighter, opponent, prop, scope, date }) }
    await start({
      messages: [system, context, user],
      tools: [reportUfcTool],
      tool_choice: 'auto',
      search_parameters: searchParams,
      temperature: 0.2,
    })
  }

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <Header />
      <div className="container mx-auto px-4 py-6 pb-24">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="bg-card-bg border border-card-border rounded-xl p-4 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold text-white">Admin · UFC Props</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-muted border border-card-border text-gray-secondary">Proxy: {import.meta.env.VITE_GROK_FUNCTION_PATH || '/.netlify/functions/grok'}</span>
            </div>
            <p className="text-sm text-gray-secondary mb-4">Return last fight or specific date metrics with citations from UFCStats/ESPN.</p>
            <div className="text-xs text-gray-400 mb-4">Status: <span className="inline-block px-2 py-0.5 rounded-full bg-black/30 border border-card-border text-gray-200">{status}</span>{result?.finishedAt ? <span className="ml-3">Finished: {new Date(result.finishedAt).toLocaleTimeString()}</span> : null}</div>
            <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-secondary mb-1">Fighter</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={fighter} onChange={(e)=>setFighter(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-secondary mb-1">Opponent (optional)</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" placeholder="Opponent name" value={opponent} onChange={(e)=>setOpponent(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Scope</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={scope} onChange={(e)=>setScope(e.target.value)}>
                  <option value="last_fight">Last Fight</option>
                  <option value="on_date">On Date</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Prop</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={prop} onChange={(e)=>setProp(e.target.value)}>
                  <option value="significant_strikes_landed">Significant Strikes Landed</option>
                  <option value="total_strikes_landed">Total Strikes Landed</option>
                  <option value="takedowns_landed">Takedowns Landed</option>
                  <option value="takedown_attempts">Takedown Attempts</option>
                  <option value="control_time_seconds">Control Time (seconds)</option>
                  <option value="knockdowns">Knockdowns</option>
                  <option value="submission_attempts">Submission Attempts</option>
                </select>
              </div>
              {scope === 'on_date' && (
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">Date</label>
                  <input type="date" className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={date} onChange={(e)=>setDate(e.target.value)} />
                </div>
              )}
              <div className="md:col-span-5">
                <label className="block text-sm text-gray-secondary mb-1">Free prompt (optional)</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" placeholder="Override prompt..." value={freePrompt} onChange={(e)=>setFreePrompt(e.target.value)} />
              </div>
              <div className="md:col-span-5 flex gap-2 flex-wrap items-center">
                <button type="submit" className="bg-green-bright text-dark-bg font-extrabold rounded-full px-5 py-2 disabled:opacity-50" disabled={status==='starting'||status==='running'}>{status==='running'?'Running…':'Query'}</button>
                <button type="button" className="border border-card-border rounded-full px-4 py-2 text-gray-100 hover:border-green-bright transition-colors disabled:opacity-60" onClick={reset} disabled={status==='starting'||status==='running'}>Reset</button>
                {error && <span className="text-red-500 text-sm">{String(error.message || error.error || 'Error')}</span>}
              </div>
            </form>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card-bg border border-card-border rounded-xl p-4 shadow-lg shadow-black/40">
              <h3 className="text-white font-semibold mb-2">Structured Result</h3>
              {result?.toolCalls?.length ? (
                <>
                  <div className="flex flex-wrap gap-2 mb-3 text-xs">
                    {(() => { try {
                      const a = result.toolCalls[0]?.function?.arguments || {}
                      const chips = []
                      if (a.value != null) chips.push(<span key="v" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Value: {String(a.value)} {a.units || ''}</span>)
                      if (a.fight?.opponent) chips.push(<span key="o" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Opp: {a.fight.opponent}</span>)
                      if (a.fight?.date) chips.push(<span key="d" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Date: {a.fight.date}</span>)
                      if (a.confidence != null) chips.push(<span key="c" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Conf: {Math.round(Number(a.confidence)*100)}%</span>)
                      return chips
                    } catch { return null } })()}
                  </div>
                  <pre className="text-xs bg-black/40 text-gray-200 p-3 rounded-md max-h-96 overflow-auto border border-card-border">{JSON.stringify(result.toolCalls[0]?.function?.arguments ?? {}, null, 2)}</pre>
                </>
              ) : (
                <div className="text-sm text-gray-secondary">No tool result yet. Submit a query.</div>
              )}
            </div>

            <div className="bg-card-bg border border-card-border rounded-xl p-4 shadow-lg shadow-black/40">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-semibold">Raw Response</h3>
              </div>
              <div className="text-xs text-gray-300 mb-2">
                {result?.raw?.model ? (<span>Model: <code className="bg-black/40 px-1 rounded">{result.raw.model}</code></span>) : null}
                {result?.usage?.num_sources_used != null ? (
                  <span className="ml-3">Sources used: <code className="bg-black/40 px-1 rounded">{String(result.usage.num_sources_used)}</code></span>
                ) : null}
              </div>
              <pre className="text-xs bg-black/40 text-gray-200 p-3 rounded-md max-h-96 overflow-auto border border-card-border">{result ? JSON.stringify(result.raw || result, null, 2) : '— No response yet —'}</pre>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}

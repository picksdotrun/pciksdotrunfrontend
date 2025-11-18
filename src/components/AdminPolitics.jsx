import { useMemo, useState } from 'react'
import Header from './Header'
import Footer from './Footer'
import useGrokJob from '../lib/useGrokJob'

const reportPoliticalTool = {
  type: 'function',
  function: {
    name: 'report_political_metric',
    description: 'Return a single structured political/government metric with metadata and citations.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        domain: { type: 'string', enum: ['us_federal'] },
        subject: { type: 'string', description: 'e.g., executive_orders, tariffs, proclamations, bills_signed' },
        person: { type: 'string', description: 'e.g., Donald J. Trump' },
        office: { type: 'string', description: 'e.g., President of the United States' },
        scope: { type: 'string', enum: ['last_week', 'on_date', 'since_date', 'term_total'] },
        date: { type: 'string', description: 'YYYY-MM-DD if scope=on_date' },
        since_date: { type: 'string', description: 'YYYY-MM-DD if scope=since_date' },
        value: { type: 'number', description: 'Numeric result for the metric (count)' },
        units: { type: 'string', description: 'e.g., count' },
        period: { type: 'string', description: 'Human-readable period summary' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        sources: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        query_time: { type: 'string' },
      },
      required: ['domain', 'subject', 'person', 'scope', 'value', 'units'],
    },
  },
}

export default function AdminPolitics() {
  const [subject, setSubject] = useState('executive_orders')
  const [person, setPerson] = useState('Donald J. Trump')
  const [scope, setScope] = useState('term_total')
  const [date, setDate] = useState('')
  const [sinceDate, setSinceDate] = useState('')
  const [freePrompt, setFreePrompt] = useState('')

  const { status, error, start, reset, result } = useGrokJob()

  const searchParams = useMemo(() => ({
    mode: 'on',
    return_citations: true,
    max_search_results: 10,
    sources: [
      { type: 'web', allowed_websites: [
        'www.federalregister.gov',
        'www.whitehouse.gov',
        'www.congress.gov',
        'ustr.gov',
        'www.usitc.gov',
      ] },
      { type: 'news' },
    ],
  }), [])

  const toUserPrompt = () => {
    if (freePrompt.trim()) return freePrompt.trim()
    let base = `Provide the ${subject.replaceAll('_',' ')} count for ${person} (${scope.replace('_',' ')})`
    if (scope === 'on_date' && date) base += ` on ${date}`
    if (scope === 'since_date' && sinceDate) base += ` since ${sinceDate}`
    return base + '. Return the result via the report_political_metric tool with numeric value, units="count", and citations from federalregister.gov and official sources.'
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const system = {
      role: 'system',
      content: 'You are a government records stats agent. Use the report_political_metric tool to return a single structured numeric count with metadata. Cite authoritative sources (Federal Register, WhiteHouse.gov archives, Congress.gov, USTR/USITC). Prefer tool calls over prose.',
    }
    const user = { role: 'user', content: toUserPrompt() }
    const context = { role: 'user', content: JSON.stringify({ domain: 'us_federal', subject, person, scope, date, since_date: sinceDate }) }
    await start({
      messages: [system, context, user],
      tools: [reportPoliticalTool],
      tool_choice: 'auto',
      search_parameters: searchParams,
      max_tokens: 320,
      temperature: 0.1,
    })
  }

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <Header />
      <div className="container mx-auto px-4 py-6 pb-24">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="bg-card-bg border border-card-border rounded-xl p-4 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold text-white">Admin · Politics Metrics</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-muted border border-card-border text-gray-secondary">Proxy: {import.meta.env.VITE_GROK_FUNCTION_PATH || '/.netlify/functions/grok'}</span>
            </div>
            <p className="text-sm text-gray-secondary mb-4">Return counts (e.g., executive orders) with citations from FederalRegister/WhiteHouse/Congress.gov.</p>
            <div className="text-xs text-gray-400 mb-4">Status: <span className="inline-block px-2 py-0.5 rounded-full bg-surface-muted border border-card-border text-gray-secondary">{status}</span>{result?.finishedAt ? <span className="ml-3">Finished: {new Date(result.finishedAt).toLocaleTimeString()}</span> : null}</div>
            <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-secondary mb-1">Subject</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={subject} onChange={(e)=>setSubject(e.target.value)}>
                  <option value="executive_orders">Executive Orders</option>
                  <option value="tariffs_imposed">Tariffs Imposed</option>
                  <option value="tariffs_removed">Tariffs Removed</option>
                  <option value="proclamations">Proclamations</option>
                  <option value="bills_signed">Bills Signed</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-secondary mb-1">Person</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={person} onChange={(e)=>setPerson(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-secondary mb-1">Scope</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={scope} onChange={(e)=>setScope(e.target.value)}>
                  <option value="term_total">Term Total</option>
                  <option value="last_week">Last Week</option>
                  <option value="on_date">On Date</option>
                  <option value="since_date">Since Date</option>
                </select>
              </div>
              {scope === 'on_date' && (
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">Date</label>
                  <input type="date" className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={date} onChange={(e)=>setDate(e.target.value)} />
                </div>
              )}
              {scope === 'since_date' && (
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">Since Date</label>
                  <input type="date" className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={sinceDate} onChange={(e)=>setSinceDate(e.target.value)} />
                </div>
              )}
              <div className="md:col-span-6">
                <label className="block text-sm text-gray-secondary mb-1">Free prompt (optional)</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" placeholder="Override prompt..." value={freePrompt} onChange={(e)=>setFreePrompt(e.target.value)} />
              </div>
              <div className="md:col-span-6 flex gap-2 flex-wrap items-center">
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
                      if (a.scope) chips.push(<span key="sc" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Scope: {a.scope}</span>)
                      if (a.date) chips.push(<span key="d" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Date: {a.date}</span>)
                      if (a.since_date) chips.push(<span key="sd" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Since: {a.since_date}</span>)
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

import { useEffect, useState } from 'react'
import Header from './Header'
import Footer from './Footer'
import useGrokChat from '../lib/useGrokChat'
import GrokParamHelp from './GrokParamHelp'

export default function GrokTestPage() {
  const [input, setInput] = useState('')
  const [model, setModel] = useState('') // server default if blank
  const [temperature, setTemperature] = useState(0.7)
  const [showRaw, setShowRaw] = useState(true)
  const [showGuide, setShowGuide] = useState(false)
  const [topP, setTopP] = useState('') // blank = unset
  const [maxTokens, setMaxTokens] = useState('')
  const [stopText, setStopText] = useState('') // comma-separated or single string
  const [presencePenalty, setPresencePenalty] = useState('')
  const [frequencyPenalty, setFrequencyPenalty] = useState('')
  // Live Search parameters
  const [enableSearch, setEnableSearch] = useState(true)
  const [searchMode, setSearchMode] = useState('auto') // auto | on | off
  const [returnCitations, setReturnCitations] = useState(true)
  const [maxSearchResults, setMaxSearchResults] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [useWeb, setUseWeb] = useState(true)
  const [useX, setUseX] = useState(false)
  const [useNews, setUseNews] = useState(false)
  const [useRss, setUseRss] = useState(false)
  const [allowedWebsites, setAllowedWebsites] = useState('nfl.com,espn.com,pro-football-reference.com')
  const [excludedWebsites, setExcludedWebsites] = useState('')
  const [includedXHandles, setIncludedXHandles] = useState('')
  const [excludedXHandles, setExcludedXHandles] = useState('')
  const [rssLinks, setRssLinks] = useState('')

  const { messages, loading, error, send, reset, lastRaw } = useGrokChat({ model, temperature })

  // Read server default model for display
  const [serverModel, setServerModel] = useState('')
  useEffect(() => {
    const url = (import.meta.env.VITE_GROK_FUNCTION_PATH || '/.netlify/functions/grok') + '?health=1'
    fetch(url).then(async (r) => {
      try { const j = await r.json(); setServerModel(j?.model || '') } catch {}
    }).catch(() => {})
  }, [])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim()) return
    const text = input
    setInput('')
    const extra = {}
    if (topP !== '' && !Number.isNaN(Number(topP))) extra.top_p = Number(topP)
    if (maxTokens !== '' && Number.isFinite(Number(maxTokens))) extra.max_tokens = Number(maxTokens)
    if (presencePenalty !== '' && !Number.isNaN(Number(presencePenalty))) extra.presence_penalty = Number(presencePenalty)
    if (frequencyPenalty !== '' && !Number.isNaN(Number(frequencyPenalty))) extra.frequency_penalty = Number(frequencyPenalty)
    if (stopText.trim()) {
      extra.stop = stopText.includes(',')
        ? stopText.split(',').map(s => s.trim()).filter(Boolean)
        : stopText
    }
    if (enableSearch) {
      const sp = { mode: searchMode }
      if (returnCitations !== undefined) sp.return_citations = !!returnCitations
      if (maxSearchResults !== '' && Number.isFinite(Number(maxSearchResults))) sp.max_search_results = Number(maxSearchResults)
      if (fromDate) sp.from_date = fromDate
      if (toDate) sp.to_date = toDate
      const sources = []
      if (useWeb) {
        const src = { type: 'web' }
        if (allowedWebsites.trim()) src.allowed_websites = allowedWebsites.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5)
        if (excludedWebsites.trim()) src.excluded_websites = excludedWebsites.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5)
        sources.push(src)
      }
      if (useNews) {
        const src = { type: 'news' }
        if (excludedWebsites.trim()) src.excluded_websites = excludedWebsites.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5)
        sources.push(src)
      }
      if (useX) {
        const src = { type: 'x' }
        if (includedXHandles.trim()) src.included_x_handles = includedXHandles.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
        if (excludedXHandles.trim()) src.excluded_x_handles = excludedXHandles.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
        sources.push(src)
      }
      if (useRss && rssLinks.trim()) {
        const src = { type: 'rss', links: [rssLinks.trim()] }
        sources.push(src)
      }
      if (sources.length > 0) sp.sources = sources
      extra.search_parameters = sp
    }
    await send(text, extra)
  }

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <Header />
      <div className="container mx-auto px-4 py-6 pb-24">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="bg-card-bg border border-card-border rounded-xl p-4">
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm text-gray-secondary mb-1">Model (optional)
                  <span className="ml-1 text-xs text-gray-400" title="Leave blank to use server default (XAI_DEFAULT_MODEL).">?</span>
                </label>
                <input
                  className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white focus:outline-none focus:ring"
                  placeholder={serverModel ? `${serverModel} (server default)` : 'Server default if empty'}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Temperature: {temperature}
                  <span className="ml-1 text-xs text-gray-400" title="Randomness. 0 = precise, 1 = creative.">?</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Presets</label>
                <div className="flex gap-2">
                  <button type="button" className="text-xs border border-card-border hover:border-white rounded-full px-2 py-1" onClick={() => { setTemperature(0); setTopP('') }}>Deterministic</button>
                  <button type="button" className="text-xs border border-card-border hover:border-white rounded-full px-2 py-1" onClick={() => { setTemperature(0.7); setTopP('') }}>Balanced</button>
                  <button type="button" className="text-xs border border-card-border hover:border-white rounded-full px-2 py-1" onClick={() => { setTemperature(1.0); setTopP('') }}>Creative</button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Quick Preset</label>
                <div className="flex gap-2">
                  <button type="button" className="text-xs border border-card-border hover:border-white rounded-full px-2 py-1" onClick={() => {
                    setEnableSearch(true)
                    setSearchMode('on')
                    setAllowedWebsites('nfl.com,espn.com,pro-football-reference.com')
                  }}>Sports Stats (NFL)</button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input id="showRaw" type="checkbox" className="accent-green-bright" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} />
                <label htmlFor="showRaw" className="text-sm text-gray-secondary">Show raw response</label>
              </div>
              <div>
                <button
                  className="inline-flex items-center justify-center border border-card-border hover:border-green-bright text-gray-100 rounded-full px-3 py-2 text-sm"
                  onClick={reset}
                  disabled={loading}
                >
                  Reset Chat
                </button>
              </div>
              <div>
                <button
                  className="inline-flex items-center justify-center border border-card-border hover:border-green-bright text-gray-100 rounded-full px-3 py-2 text-sm"
                  onClick={() => setShowGuide(v => !v)}
                >
                  {showGuide ? 'Hide' : 'Show'} Parameter Guide
                </button>
              </div>
            </div>
          </div>

          {/* Advanced controls */}
          <details className="bg-card-bg border border-card-border rounded-xl p-4">
            <summary className="list-none cursor-pointer select-none flex items-center justify-between">
              <div className="text-white font-semibold">Advanced Parameters</div>
              <span className="text-xs text-gray-secondary">top_p, max_tokens, stop, penalties</span>
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-sm text-gray-secondary mb-1">top_p (0–1)
                  <span className="ml-1 text-xs text-gray-400" title="Nucleus sampling cutoff. Use as alternative to temp.">?</span>
                </label>
                <input
                  className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100"
                  inputMode="decimal"
                  placeholder="e.g. 0.9"
                  value={topP}
                  onChange={(e) => setTopP(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">max_tokens
                  <span className="ml-1 text-xs text-gray-400" title="Cap response length. Leave blank for default.">?</span>
                </label>
                <input
                  className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100"
                  inputMode="numeric"
                  placeholder="e.g. 256"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">stop
                  <span className="ml-1 text-xs text-gray-400" title="Comma-separated or single string where generation should stop.">?</span>
                </label>
                <input
                  className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white"
                  placeholder={`e.g. \nYou:,User:`}
                  value={stopText}
                  onChange={(e) => setStopText(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">presence_penalty (−2…2)
                  <span className="ml-1 text-xs text-gray-400" title="Encourage new topics; reduce repetition across topics.">?</span>
                </label>
                <input
                  className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white"
                  inputMode="decimal"
                  placeholder="e.g. 0.2"
                  value={presencePenalty}
                  onChange={(e) => setPresencePenalty(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">frequency_penalty (−2…2)
                  <span className="ml-1 text-xs text-gray-400" title="Reduce verbatim repetition.">?</span>
                </label>
                <input
                  className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white"
                  inputMode="decimal"
                  placeholder="e.g. 0.2"
                  value={frequencyPenalty}
                  onChange={(e) => setFrequencyPenalty(e.target.value)}
                />
              </div>
            </div>
          </details>

          {/* Live Search */}
          <details className="bg-card-bg border border-card-border rounded-xl p-4">
            <summary className="list-none cursor-pointer select-none flex items-center justify-between">
              <div className="text-white font-semibold">Live Search</div>
              <span className="text-xs text-gray-secondary">web/news/x/rss with citations</span>
            </summary>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-secondary">Enable</label>
                <input type="checkbox" className="accent-green-bright" checked={enableSearch} onChange={(e)=>setEnableSearch(e.target.checked)} />
                <label className="text-sm text-gray-secondary">Mode</label>
                <select className="border border-card-border rounded bg-dark-bg text-white px-2 py-1" value={searchMode} onChange={(e)=>setSearchMode(e.target.value)}>
                  <option value="auto">auto</option>
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
                <label className="text-sm text-gray-secondary">Return citations</label>
                <input type="checkbox" className="accent-green-bright" checked={returnCitations} onChange={(e)=>setReturnCitations(e.target.checked)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">max_search_results</label>
                  <input className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" inputMode="numeric" placeholder="e.g. 10" value={maxSearchResults} onChange={(e)=>setMaxSearchResults(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">from_date</label>
                  <input type="date" className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" value={fromDate} onChange={(e)=>setFromDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">to_date</label>
                  <input type="date" className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" value={toDate} onChange={(e)=>setToDate(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm text-gray-secondary">Sources</label>
                <label className="text-sm"><input type="checkbox" className="accent-green-bright mr-2" checked={useWeb} onChange={(e)=>setUseWeb(e.target.checked)} />web</label>
                <label className="text-sm"><input type="checkbox" className="accent-green-bright mr-2" checked={useNews} onChange={(e)=>setUseNews(e.target.checked)} />news</label>
                <label className="text-sm"><input type="checkbox" className="accent-green-bright mr-2" checked={useX} onChange={(e)=>setUseX(e.target.checked)} />x</label>
                <label className="text-sm"><input type="checkbox" className="accent-green-bright mr-2" checked={useRss} onChange={(e)=>setUseRss(e.target.checked)} />rss</label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">allowed_websites (web, comma)</label>
                  <input className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" placeholder="e.g. espn.com,nfl.com" value={allowedWebsites} onChange={(e)=>setAllowedWebsites(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">excluded_websites (web/news, comma)</label>
                  <input className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" placeholder="e.g. wikipedia.org" value={excludedWebsites} onChange={(e)=>setExcludedWebsites(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">included_x_handles (comma)</label>
                  <input className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" placeholder="e.g. NFL,Chiefs" value={includedXHandles} onChange={(e)=>setIncludedXHandles(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">excluded_x_handles (comma)</label>
                  <input className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" placeholder="e.g. grok" value={excludedXHandles} onChange={(e)=>setExcludedXHandles(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-secondary mb-1">rss link</label>
                  <input className="w-full border border-card-border rounded px-3 py-2 bg-dark-bg text-white" placeholder="https://example.com/feed.xml" value={rssLinks} onChange={(e)=>setRssLinks(e.target.value)} />
                </div>
              </div>
            </div>
          </details>

          {showGuide && (
            <div className="bg-card-bg border border-card-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-semibold">Grok Parameter Guide</h3>
                <span className="text-xs text-gray-secondary">Model & sampling controls</span>
              </div>
              <GrokParamHelp />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card-bg border border-card-border rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3">Chat</h3>
              <div className="space-y-2 max-h-96 overflow-auto mb-3">
                {messages.length === 0 && (
                  <div className="text-sm text-gray-secondary">Start a conversation with Grok…</div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={m.role === 'assistant' ? 'text-gray-100' : 'text-gray-300'}>
                    <span className="font-medium mr-2">{m.role === 'assistant' ? 'Grok:' : 'You:'}</span>
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  </div>
                ))}
                {loading && <div className="text-sm text-gray-secondary">Thinking…</div>}
                {error && <div className="text-sm text-red-500">{String(error.message || error)}</div>}
              </div>
              <form onSubmit={onSubmit} className="flex gap-2">
                <input
                  className="flex-1 border border-card-border rounded px-3 py-2 bg-dark-bg text-white focus:outline-none focus:ring"
                  placeholder="Ask anything…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={loading}
                />
                <button
                  className="bg-green-bright text-dark-bg font-extrabold rounded-full px-5 py-2 disabled:opacity-50"
                  type="submit"
                  disabled={loading}
                >
                  Send
                </button>
              </form>
            </div>

            <div className="bg-card-bg border border-card-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-semibold">Raw Response</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-secondary">Proxy: {import.meta.env.VITE_GROK_FUNCTION_PATH || '/.netlify/functions/grok'}</span>
                </div>
              </div>
              <div className="text-xs text-gray-300 mb-2">
                {lastRaw?.model ? (<span>Model: <code className="bg-black/40 px-1 rounded">{lastRaw.model}</code></span>) : null}
                {lastRaw?.usage?.num_sources_used != null ? (
                  <span className="ml-3">Sources used: <code className="bg-black/40 px-1 rounded">{String(lastRaw.usage.num_sources_used)}</code></span>
                ) : null}
              </div>
              {showRaw ? (
                <pre className="text-xs bg-black/40 text-gray-200 p-3 rounded-md max-h-96 overflow-auto">
{lastRaw ? JSON.stringify(lastRaw, null, 2) : '— No response yet —'}
                </pre>
              ) : (
                <div className="text-sm text-gray-secondary">Raw output hidden</div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}

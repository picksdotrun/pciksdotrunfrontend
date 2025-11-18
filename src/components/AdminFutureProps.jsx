import { useMemo, useState } from 'react'
import Header from './Header'
import Footer from './Footer'
import useGrokJob from '../lib/useGrokJob'
import { supabase } from '../lib/supabase'
import { launchEvmMarket } from '../lib/launchTokens'
import { useProfile } from '../lib/useProfile'
import { PICK_CATEGORY_OPTIONS, normalizePickCategory, DEFAULT_PICK_CATEGORY } from '../lib/pickCategories'

// Tool definition for future (upcoming) prop lines similar to PrizePicks
const reportFuturePropTool = {
  type: 'function',
  function: {
    name: 'report_future_prop_line',
    description: 'Return a single upcoming (future) sports prop line with metadata and citations, similar to PrizePicks.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sport: { type: 'string', enum: ['nfl'] },
        player: { type: 'string', description: 'Full player name' },
        team: { type: 'string', description: 'Team abbreviation (e.g., KC) or full name' },
        prop: { type: 'string', enum: [
          'passing_touchdowns', 'rushing_touchdowns', 'receiving_touchdowns',
          'passing_yards', 'rushing_yards', 'receiving_yards', 'receptions',
          'interceptions_thrown', 'completions'
        ] },
        scope: { type: 'string', enum: ['next_game', 'on_date'] },
        date: { type: 'string', description: 'YYYY-MM-DD if scope=on_date' },
        line: { type: 'number', description: 'Projected/priced line (e.g., 274.5)' },
        units: { type: 'string', description: 'e.g., yards, TD, receptions' },
        sportsbook: { type: 'string', description: 'e.g., PrizePicks, consensus, DraftKings' },
        game: {
          type: 'object',
          additionalProperties: false,
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            kickoff_time_utc: { type: 'string', description: 'ISO8601 UTC kickoff time if available' },
            opponent: { type: 'string' },
            home_or_away: { type: 'string', enum: ['home', 'away', 'neutral'] },
            competition: { type: 'string', enum: ['regular_season', 'postseason', 'preseason'] },
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        sources: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        query_time: { type: 'string' },
      },
      required: ['sport', 'player', 'prop', 'line', 'units'],
    },
  },
}

const PROP_LABELS = {
  passing_touchdowns: 'Passing TDs',
  rushing_touchdowns: 'Rushing TDs',
  receiving_touchdowns: 'Receiving TDs',
  passing_yards: 'Passing Yards',
  rushing_yards: 'Rushing Yards',
  receiving_yards: 'Receiving Yards',
  receptions: 'Receptions',
  interceptions_thrown: 'Interceptions Thrown',
  completions: 'Completions',
}

function toCategoryFromProp(prop) {
  return normalizePickCategory(PROP_LABELS[prop] || prop)
}

function pickName(player) {
  return player || 'Player'
}

function buildDescription({ player, team, args }) {
  const bits = []
  if (args?.game?.opponent) bits.push(`vs ${args.game.opponent}`)
  if (args?.game?.date) bits.push(`on ${args.game.date}`)
  const when = bits.length ? ` (${bits.join(' ')})` : ''
  const src = Array.isArray(args?.sources) && args.sources.length ? ` Source: ${args.sources[0]}` : ''
  const book = args?.sportsbook ? ` (${args.sportsbook})` : ''
  return `${player}${team ? ` (${team})` : ''}${when}.${book}${src}`.trim()
}

export default function AdminFutureProps() {
  const { profile } = useProfile()
  const [player, setPlayer] = useState('Patrick Mahomes')
  const [team, setTeam] = useState('KC')
  const [prop, setProp] = useState('passing_yards')
  const [scope, setScope] = useState('next_game')
  const [date, setDate] = useState('')
  const [freePrompt, setFreePrompt] = useState('')
  const [autoLaunch, setAutoLaunch] = useState(true)
  const [schedInterval, setSchedInterval] = useState(60)
  const [creating, setCreating] = useState(false)
  const [categoryOverride, setCategoryOverride] = useState(DEFAULT_PICK_CATEGORY)

  const { status, error, start, reset, result } = useGrokJob()

  const searchParams = useMemo(() => ({
    mode: 'on',
    return_citations: true,
    max_search_results: 10,
    sources: [
      // Keep within 5 allowed_websites
      { type: 'web', allowed_websites: ['prizepicks.com', 'underdogfantasy.com', 'espn.com', 'rotowire.com', 'pro-football-reference.com'] },
      { type: 'news' },
    ],
  }), [])

  const toUserPrompt = () => {
    if (freePrompt.trim()) return freePrompt.trim()
    const base = `Find the ${prop.replaceAll('_', ' ')} line for ${player}${team ? ` (${team})` : ''} in the ${scope.replace('_',' ')}.`
    const extra = scope === 'on_date' && date ? ` The game date is ${date}.` : ''
    return base + extra + ' Return the result via the report_future_prop_line tool with the projected/priced line, units, game/opponent details, sportsbook/source, and citations.'
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const categoryInstruction = 'Always classify the pick into one of these categories and include it in the tool call: Politics, Sports, Culture, Crypto, Climate, Economics, Mentions, Companies, Financials, Tech & Science, Health, World.'
    const system = {
      role: 'system',
      content: 'You are a sports props agent. Use the report_future_prop_line tool to return a structured upcoming line (PrizePicks-style) with numeric line and metadata. Prefer a tool call over prose. Cite authoritative sources (PrizePicks/Underdog/ESPN/etc.). ' + categoryInstruction,
    }
    const user = { role: 'user', content: toUserPrompt() }
    const context = { role: 'user', content: JSON.stringify({ sport: 'nfl', player, team, prop, scope, date }) }
    await start({
      messages: [system, context, user],
      tools: [reportFuturePropTool],
      tool_choice: 'auto',
      search_parameters: searchParams,
      temperature: 0.2,
      max_tokens: 320,
    })
  }

  const createFromResult = async () => {
    if (!result?.toolCalls?.length) return
    const args = result.toolCalls[0]?.function?.arguments || {}
    const line = Number(args.line)
    if (!Number.isFinite(line)) {
      alert('Tool result missing a numeric line')
      return
    }
    const category = toCategoryFromProp(args.prop || prop)
    setCategoryOverride(category)
    const name = pickName(args.player || player)
    // Prefer provided kickoff_time_utc, else use date at noon UTC
    let expiresAt = null
    if (args?.game?.kickoff_time_utc) {
      const t = new Date(args.game.kickoff_time_utc)
      if (!Number.isNaN(t.valueOf())) expiresAt = t.toISOString()
    }
    if (!expiresAt && args?.game?.date) {
      const t = new Date(`${args.game.date}T12:00:00Z`)
      if (!Number.isNaN(t.valueOf())) expiresAt = t.toISOString()
    }
    const description = buildDescription({ player: args.player || player, team: args.team || team, args })
    const payload = {
      name,
      line: line,
      category: categoryOverride,
      description,
      image: null,
      team: args.team || team || null,
      expires_at: expiresAt,
      status: 'open',
      creator_id: profile?.id || null,
      creator_wallet: profile?.wallet || null,
    }
    setCreating(true)
    try {
      const { data, error: insErr } = await supabase.from('picks').insert(payload).select().single()
      if (insErr) throw insErr
      if (autoLaunch) {
        try {
          await launchEvmMarket({
            pickId: data.id,
            name: data.name,
            line: data.line,
            category: data.category,
            description: data.description,
            creatorId: profile?.id || null,
          })
        } catch (e) {
          console.error('Token launch failed (prediction saved):', e)
        }
      }
      alert('Future prop created!')
    } catch (e) {
      console.error('Create pick failed', e)
      alert(e?.message || 'Failed to create pick')
    } finally {
      setCreating(false)
    }
  }

  const addToScheduler = async () => {
    try {
      const payload = {
        sport: 'nfl',
        player,
        team,
        prop,
        scope,
        date: date || null,
        run_interval_minutes: Number.isFinite(Number(schedInterval)) ? Number(schedInterval) : 60,
        enabled: true,
        create_pick: true,
        auto_launch: !!autoLaunch,
        category: categoryOverride,
      }
      const { error } = await supabase.from('future_prop_requests').insert(payload)
      if (error) throw error
      alert('Added to scheduler queue')
    } catch (e) {
      alert((e?.message) || 'Failed to add to scheduler')
    }
  }

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <Header />
      <div className="container mx-auto px-4 py-6 pb-24">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="bg-card-bg border border-card-border rounded-xl p-4 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold text-white">Admin · Future Props (PrizePicks‑style)</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-muted border border-card-border text-gray-secondary">Proxy: {import.meta.env.VITE_GROK_FUNCTION_PATH || '/.netlify/functions/grok'}</span>
            </div>
            <p className="text-sm text-gray-secondary mb-4">Look up upcoming lines (next game or specific date), create a pick with kickoff expiry, and optionally auto‑launch tokens.</p>
            <div className="text-xs text-gray-400 mb-4">Status: <span className="inline-block px-2 py-0.5 rounded-full bg-surface-muted border border-card-border text-gray-secondary">{status}</span>{result?.finishedAt ? <span className="ml-3">Finished: {new Date(result.finishedAt).toLocaleTimeString()}</span> : null}</div>
            <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-secondary mb-1">Player</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={player} onChange={(e)=>setPlayer(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Team</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={team} onChange={(e)=>setTeam(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Prop</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={prop} onChange={(e)=>setProp(e.target.value)}>
                  <option value="passing_yards">Passing Yards</option>
                  <option value="rushing_yards">Rushing Yards</option>
                  <option value="receiving_yards">Receiving Yards</option>
                  <option value="receptions">Receptions</option>
                  <option value="passing_touchdowns">Passing TDs</option>
                  <option value="rushing_touchdowns">Rushing TDs</option>
                  <option value="receiving_touchdowns">Receiving TDs</option>
                  <option value="completions">Completions</option>
                  <option value="interceptions_thrown">Interceptions Thrown</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Category</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={categoryOverride} onChange={(e)=>setCategoryOverride(e.target.value)}>
                  {PICK_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-secondary mb-1">Scope</label>
                <select className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={scope} onChange={(e)=>setScope(e.target.value)}>
                  <option value="next_game">Next Game</option>
                  <option value="on_date">On Date</option>
                </select>
              </div>
              {scope === 'on_date' && (
                <div>
                  <label className="block text-sm text-gray-secondary mb-1">Date</label>
                  <input type="date" className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" value={date} onChange={(e)=>setDate(e.target.value)} />
                </div>
              )}
              <div className="md:col-span-6">
                <label className="block text-sm text-gray-secondary mb-1">Free prompt (optional)</label>
                <input className="w-full border border-card-border rounded px-3 py-2 bg-surface-muted text-gray-100 focus:outline-none focus:border-green-bright" placeholder="Override prompt..." value={freePrompt} onChange={(e)=>setFreePrompt(e.target.value)} />
              </div>
              <div className="md:col-span-6 flex items-center gap-4 flex-wrap">
                <button type="submit" className="bg-green-bright text-dark-bg font-extrabold rounded-full px-5 py-2 disabled:opacity-50" disabled={status==='starting'||status==='running'}>{status==='running'?'Looking up…':'Grok Lookup'}</button>
                <label className="inline-flex items-center gap-2 text-sm text-gray-secondary">
                  <input type="checkbox" className="accent-green-bright" checked={autoLaunch} onChange={(e)=>setAutoLaunch(e.target.checked)} />
                  Auto‑launch tokens on create
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-secondary">
                  <span>Schedule every</span>
                  <input className="w-16 border border-card-border rounded px-2 py-1 bg-surface-muted text-gray-100 text-center focus:outline-none focus:border-green-bright" inputMode="numeric" value={schedInterval} onChange={(e)=>setSchedInterval(e.target.value)} />
                  <span>min</span>
                </label>
                <button type="button" className="border border-card-border rounded-full px-4 py-2 text-gray-100 hover:border-green-bright transition-colors" onClick={addToScheduler}>Add to Scheduler</button>
                <button type="button" className="border border-card-border rounded-full px-4 py-2 text-gray-100 hover:border-green-bright transition-colors disabled:opacity-60" onClick={() => { reset(); setCategoryOverride(DEFAULT_PICK_CATEGORY) }} disabled={status==='starting'||status==='running'}>Reset</button>
                {error && <span className="text-red-500 text-sm">{String(error.message || error.error || 'Error')}</span>}
              </div>
            </form>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card-bg border border-card-border rounded-xl p-4 shadow-lg shadow-black/40">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-semibold">Structured Line</h3>
                <button className="text-xs border border-card-border rounded-full px-3 py-1 text-gray-100 hover:border-green-bright transition-colors disabled:opacity-50" disabled={!result?.toolCalls?.length || creating} onClick={createFromResult}>{creating ? 'Creating…' : 'Create Pick'}</button>
              </div>
              {result?.toolCalls?.length ? (
                <>
                  <div className="flex flex-wrap gap-2 mb-3 text-xs">
                    {(() => { try {
                      const a = result.toolCalls[0]?.function?.arguments || {}
                      const chips = []
                      if (a.line != null) chips.push(<span key="l" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Line: {String(a.line)} {a.units || ''}</span>)
                      if (a.game?.opponent) chips.push(<span key="o" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Opp: {a.game.opponent}</span>)
                      if (a.game?.date) chips.push(<span key="d" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Date: {a.game.date}</span>)
                      if (a.sportsbook) chips.push(<span key="b" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Book: {a.sportsbook}</span>)
                      if (a.confidence != null) chips.push(<span key="c" className="px-2 py-0.5 rounded-full bg-black/40 border border-card-border">Conf: {Math.round(Number(a.confidence)*100)}%</span>)
                      return chips
                    } catch { return null } })()}
                  </div>
                  <pre className="text-xs bg-black/40 text-gray-200 p-3 rounded-md max-h-96 overflow-auto border border-card-border">{JSON.stringify(result.toolCalls[0]?.function?.arguments ?? {}, null, 2)}</pre>
                </>
              ) : (
                <div className="text-sm text-gray-secondary">Run a lookup to populate this.</div>
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

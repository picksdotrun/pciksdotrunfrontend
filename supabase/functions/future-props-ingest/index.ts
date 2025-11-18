// Supabase Edge Function: future-props-ingest
// - Scans scheduled requests in future_prop_requests that are due
// - Uses xAI (Grok) tool call to fetch upcoming prop line
// - Creates/updates a pick in public.picks and optionally launches tokens

type Json = Record<string, unknown>

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const v = Deno.env.get(name)
  if (required && (!v || !v.trim())) throw new Error(`Missing env: ${name}`)
  return v?.trim()
}

function sanitizeSearchParameters(sp: any) {
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
  } catch {
    return sp
  }
}

async function callXai({ messages, search_parameters }: { messages: any[]; search_parameters?: any }) {
  const XAI_API_KEY = getEnv('XAI_API_KEY', true)!
  const XAI_API_BASE = getEnv('XAI_API_BASE') || 'https://api.x.ai'
  const XAI_DEFAULT_MODEL = getEnv('XAI_DEFAULT_MODEL') || 'grok-4-latest'
  const url = `${XAI_API_BASE.replace(/\/$/, '')}/v1/chat/completions`
  const payload: any = {
    model: XAI_DEFAULT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 320,
    search_parameters: sanitizeSearchParameters(search_parameters || {
      mode: 'on',
      return_citations: true,
      max_search_results: 10,
      sources: [
        { type: 'web', allowed_websites: ['prizepicks.com', 'underdogfantasy.com', 'espn.com', 'rotowire.com', 'pro-football-reference.com'] },
        { type: 'news' },
      ],
    }),
    tools: [
      {
        type: 'function',
        function: {
          name: 'report_future_prop_line',
          description: 'Return a single upcoming (future) sports prop line with metadata and citations, similar to PrizePicks.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sport: { type: 'string', enum: ['nfl'] },
              player: { type: 'string' },
              team: { type: 'string' },
              prop: { type: 'string', enum: [
                'passing_touchdowns','rushing_touchdowns','receiving_touchdowns','passing_yards','rushing_yards','receiving_yards','receptions','interceptions_thrown','completions'] },
              scope: { type: 'string', enum: ['next_game','on_date'] },
              date: { type: 'string' },
              line: { type: 'number' },
              units: { type: 'string' },
              sportsbook: { type: 'string' },
              game: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  date: { type: 'string' },
                  kickoff_time_utc: { type: 'string' },
                  opponent: { type: 'string' },
                  home_or_away: { type: 'string', enum: ['home','away','neutral'] },
                  competition: { type: 'string', enum: ['regular_season','postseason','preseason'] },
                },
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              sources: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
              query_time: { type: 'string' },
            },
            required: ['sport','player','prop','line','units'],
          },
        },
      }
    ],
    tool_choice: 'auto',
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const text = await res.text()
  if (!res.ok) throw new Error(`xAI error ${res.status}: ${text}`)
  let data: any
  try { data = JSON.parse(text) } catch { throw new Error('Invalid JSON from xAI') }
  const msg = data?.choices?.[0]?.message || {}
  let args: any = null
  try {
    const first = Array.isArray(msg?.tool_calls) ? msg.tool_calls[0] : null
    if (first?.function?.arguments) {
      const a = first.function.arguments
      args = typeof a === 'string' ? JSON.parse(a) : a
    }
  } catch {}
  return { raw: data, args }
}

function toCategoryFromProp(prop?: string) {
  const map: Record<string, string> = {
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
  if (!prop) return 'UNITS'
  return map[prop] || prop
}

function buildDescription(player?: string, team?: string, args?: any) {
  const bits: string[] = []
  if (args?.game?.opponent) bits.push(`vs ${args.game.opponent}`)
  if (args?.game?.date) bits.push(`on ${args.game.date}`)
  const when = bits.length ? ` (${bits.join(' ')})` : ''
  const src = Array.isArray(args?.sources) && args.sources.length ? ` Source: ${args.sources[0]}` : ''
  const book = args?.sportsbook ? ` (${args.sportsbook})` : ''
  return `${player || 'Player'}${team ? ` (${team})` : ''}${when}.${book}${src}`.trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const body = (req.method === 'POST') ? await req.json().catch(() => ({})) : {}
    const limit = Math.min(Number(body?.limit) || 5, 20)
    // Due items (or forced ids passed in body.ids)
    let items: any[] = []
    if (Array.isArray(body?.ids) && body.ids.length) {
      const { data } = await supabase.from('future_prop_requests').select('*').in('id', body.ids)
      items = data || []
    } else {
      const { data } = await supabase
        .from('future_prop_requests')
        .select('*')
        .eq('enabled', true)
        .or('next_run_at.is.null,next_run_at.lte.now()')
        .order('next_run_at', { ascending: true })
        .limit(limit)
      items = data || []
    }
    const results: any[] = []
    for (const r of items) {
      const nowIso = new Date().toISOString()
      try {
        // Prepare messages
        const system = { role: 'system', content: 'You are a sports props agent. Use the report_future_prop_line tool to return a structured upcoming line (PrizePicks-style) with numeric line and metadata. Prefer a tool call over prose. Cite authoritative sources.' }
        const context = { role: 'user', content: JSON.stringify({ sport: r.sport || 'nfl', player: r.player, team: r.team, prop: r.prop, scope: r.scope || 'next_game', date: r.date || null }) }
        const user = { role: 'user', content: `Find the ${r.prop?.replaceAll('_',' ')} line for ${r.player}${r.team ? ` (${r.team})` : ''} in the ${(r.scope || 'next_game').replace('_',' ')}. ${r.date ? `The game date is ${r.date}. ` : ''}Return the result via the report_future_prop_line tool.` }
        const { args } = await callXai({ messages: [system as any, context as any, user as any] })
        let line = Number(args?.line)
        if (!Number.isFinite(line)) throw new Error('No numeric line returned')
        const playerName = String(args?.player || r.player)
        const category = toCategoryFromProp(String(args?.prop || r.prop))
        // Determine expires_at
        let expiresAt: string | null = null
        if (args?.game?.kickoff_time_utc) {
          const t = new Date(args.game.kickoff_time_utc)
          if (!Number.isNaN(t.valueOf())) expiresAt = t.toISOString()
        }
        if (!expiresAt && args?.game?.date) {
          const t = new Date(`${args.game.date}T12:00:00Z`)
          if (!Number.isNaN(t.valueOf())) expiresAt = t.toISOString()
        }
        const description = buildDescription(playerName, String(args?.team || r.team || ''), args)
        const payload = { name: playerName, line, category, description, image: null, team: args?.team || r.team || null, expires_at: expiresAt, status: 'open' }
        // Idempotent insert: avoid duplicates for same name/category near same expires_at
        let existing: any = null
        if (expiresAt) {
          const from = new Date(new Date(expiresAt).getTime() - 24*3600*1000).toISOString()
          const to = new Date(new Date(expiresAt).getTime() + 24*3600*1000).toISOString()
          const { data: found } = await supabase
            .from('picks')
            .select('id,name,category,expires_at,status')
            .eq('name', payload.name)
            .eq('category', payload.category)
            .eq('status', 'open')
            .gte('expires_at', from)
            .lte('expires_at', to)
            .limit(1)
          existing = (found && found[0]) || null
        }
        let pickId: string | null = null
        if (!existing) {
          const { data: ins, error: insErr } = await supabase.from('picks').insert(payload as any).select('id').single()
          if (insErr) throw insErr
          pickId = (ins as any)?.id
        } else {
          pickId = existing.id
        }
        // Optional auto-launch
        if (r.auto_launch && pickId) {
          try {
            const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/launch-pair`
            const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }, body: JSON.stringify({ pickId, name: payload.name, line: String(payload.line), category: payload.category, description: payload.description }) })
            await resp.json().catch(()=>({})) // best effort
          } catch (_) {}
        }
        // Update request bookkeeping
        const nextRun = new Date(Date.now() + (Number(r.run_interval_minutes || 60) * 60000)).toISOString()
        await supabase
          .from('future_prop_requests')
          .update({ last_run_at: nowIso, next_run_at: nextRun, last_line: line, last_units: String(args?.units || ''), last_error: null, updated_at: nowIso })
          .eq('id', r.id)
        results.push({ id: r.id, ok: true, pickId, line })
      } catch (e) {
        const err = (e as Error)?.message || String(e)
        const nowIso2 = new Date().toISOString()
        await supabase.from('future_prop_requests').update({ last_run_at: nowIso2, last_error: err, next_run_at: new Date(Date.now() + (Number(r.run_interval_minutes || 60) * 60000)).toISOString() }).eq('id', r.id)
        results.push({ id: r.id, ok: false, error: err })
      }
    }
    return json(200, { success: true, count: results.length, results })
  } catch (e) {
    return json(500, { error: (e as Error)?.message || 'Server error' })
  }
})


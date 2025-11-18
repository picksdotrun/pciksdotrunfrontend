import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PlayerGrid from './PlayerGrid'
import Footer from './Footer'
import AddPlayerModal from './AddPlayerModal'
// import DetailPanel from './DetailPanel'
import { launchEvmMarket } from '../lib/launchTokens'
import LaunchProgress from './LaunchProgress'
import { NowProvider } from '../lib/NowContext'
import { useProfile } from '../lib/useProfile'
import { enrichPicksWithCreators, enrichSinglePick } from '../lib/enrichCreators'
import { HOME_CATEGORY_LOOKUP, DEFAULT_CATEGORY_SLUG, resolveCategorySlug } from '../lib/categoryFilters'

function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authenticated, profile, walletAddress } = useProfile()
  const [selectedPlayers, setSelectedPlayers] = useState([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  // Side detail panel removed; navigate to /pick/:id instead
  const [showLaunchProgress, setShowLaunchProgress] = useState(false)
  const [launchPct, setLaunchPct] = useState(0)
  const [launchMsg, setLaunchMsg] = useState('')
  const activeCategorySlug = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '')
      return resolveCategorySlug(params.get('category'))
    } catch {
      return DEFAULT_CATEGORY_SLUG
    }
  }, [location.search])
  const activeCategoryFilter = HOME_CATEGORY_LOOKUP[activeCategorySlug] || HOME_CATEGORY_LOOKUP[DEFAULT_CATEGORY_SLUG]

  const toNumber = (value) => {
    if (typeof value === 'number') return value
    if (typeof value === 'bigint') return Number(value)
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed.length) return 0
      const asFloat = Number(trimmed)
      if (Number.isFinite(asFloat)) return asFloat
      try {
        return Number(BigInt(trimmed))
      } catch {
        return 0
      }
    }
    return 0
  }
  const normalizeCategory = (value) => (value || '').toString().trim().toLowerCase()
  const trendingScore = (pick) => {
    const volume =
      toNumber(pick.trading_volume_wei) ||
      toNumber(pick.total_volume_wei) ||
      toNumber(pick.volume_total) ||
      toNumber(pick.morevolume) ||
      toNumber(pick.lessvolume)
    const holders = toNumber(pick.holders_total)
    const impressions = toNumber(pick.public_metrics?.impression_count)
    return volume * 10 + holders * 5 + impressions
  }
  const createdAtTs = (pick) => {
    const ts = pick?.created_at
    if (!ts) return 0
    const date = new Date(ts)
    return Number.isNaN(date.getTime()) ? 0 : date.getTime()
  }
  const displayedPlayers = useMemo(() => {
    if (!Array.isArray(players)) return []
    if (!activeCategoryFilter) return players
    if (activeCategoryFilter.kind === 'trending') {
      const sorted = [...players]
      sorted.sort((a, b) => trendingScore(b) - trendingScore(a))
      return sorted
    }
    if (activeCategoryFilter.kind === 'new') {
      const sorted = [...players]
      sorted.sort((a, b) => createdAtTs(b) - createdAtTs(a))
      return sorted
    }
    if (activeCategoryFilter.kind === 'category') {
      const match = normalizeCategory(activeCategoryFilter.match || activeCategoryFilter.label)
      return players.filter((p) => normalizeCategory(p.category) === match)
    }
    return players
  }, [players, activeCategoryFilter])

  const handlePlayerSelection = (player) => {
    setSelectedPlayers(prev => {
      const exists = prev.find(p => p.id === player.id)
      if (exists) {
        return prev.filter(p => p.id !== player.id)
      }
      return [...prev, player]
    })
  }

  // Tokens are updated by realtime channel; no side panel synchronization needed

  const handleAddPlayer = async (newPlayer) => {
    const toNullable = (value) => {
      if (value === null || value === undefined) return null
      const str = typeof value === 'string' ? value.trim() : String(value).trim()
      return str.length ? str : null
    }
    const payload = {
      name: newPlayer.name,
      line: newPlayer.line,
      category: newPlayer.category,
      description: toNullable(newPlayer.description),
      image: newPlayer.image || null,
      team: toNullable(newPlayer.team),
      yes_label: toNullable(newPlayer.yesLabel),
      yes_value: toNullable(newPlayer.yesValue),
      no_label: toNullable(newPlayer.noLabel),
      no_value: toNullable(newPlayer.noValue),
      yes_probability: Number.isFinite(Number(newPlayer.yesProbability)) ? Number(newPlayer.yesProbability) : null,
      duration_sec: newPlayer.durationSec || 3600,
      expires_at: newPlayer.expiresAt || null,
      status: 'open',
      creator_wallet: walletAddress || null,
      creator_id: profile?.id || null,
    }
    const { data, error } = await supabase.from('picks').insert(payload).select().single()
    if (error) throw error
    // Deploy EVM market (YES/NO shares) immediately after creation
    try {
      // Start simulated progress (~60s)
      setShowLaunchProgress(true)
      setLaunchPct(0)
      setLaunchMsg('Preparing EVM market…')
      let start = Date.now()
      let durationMs = 60000 // 60s
      const tick = () => {
        const elapsed = Date.now() - start
        const pct = Math.min(100, Math.floor((elapsed / durationMs) * 100))
        setLaunchPct(pct)
        if (pct < 33) setLaunchMsg('Preparing EVM market…')
        else if (pct < 66) setLaunchMsg('Deploying market + tokens…')
        else if (pct < 99) setLaunchMsg('Finalizing addresses…')
      }
      const interval = setInterval(tick, 500)

      const launch = await launchEvmMarket({
        pickId: data.id,
        name: data.name,
        line: data.line,
        category: data.category,
        description: data.description,
        image: data.image,
        userId: 'system',
        durationSec: data.duration_sec != null ? Number(data.duration_sec) : undefined,
        expiresAt: data.expires_at || undefined,
        creatorId: profile?.id || null,
      })
      clearInterval(interval)
      setLaunchPct(100)
      setLaunchMsg('Completed!')
      setTimeout(() => setShowLaunchProgress(false), 1200)
      const withTokens = {
        ...data,
        evm_market_address: launch.marketAddress,
        evm_yes_token_address: launch.yesShareAddress,
        evm_no_token_address: launch.noShareAddress,
        evm_asset_address: launch.asset,
        evm_market_type: launch.marketType,
      }
      const enriched = await enrichSinglePick(withTokens)
      setPlayers(prev => [enriched, ...prev])

      return enriched
    } catch (e) {
      setLaunchMsg('Failed to launch tokens')
      setLaunchPct(100)
      setTimeout(() => setShowLaunchProgress(false), 1500)
      console.error('Token launch failed (prediction saved):', e)
      const enrichedFallback = await enrichSinglePick(data)
      setPlayers(prev => [enrichedFallback, ...prev])
      return enrichedFallback
    }
  }

  // Open create modal when query param ?new=1 is present
  useEffect(() => {
    try {
      const sp = new URLSearchParams(location.search || '')
      const wantsNew = sp.get('new') === '1'
      if (wantsNew) setShowAddModal(true)
    } catch {}
  }, [location.search])

  // Initial load from Supabase
  useEffect(() => {
    let isMounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('picks')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        const enriched = await enrichPicksWithCreators(data || [])
        if (isMounted) setPlayers(enriched)
      } catch (err) {
        console.error('Failed to load picks:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    })()
    // Realtime updates for picks (holders/volume/etc.)
    const channel = supabase
      .channel('picks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'picks' },
        async (payload) => {
          const row = payload.new || payload.record
          if (!row || !row.id) return
          const enrichedRow = await enrichSinglePick(row)
          setPlayers((prev) => {
            const has = prev.some((p) => p.id === row.id)
            if (has) {
              return prev.map((p) => (p.id === row.id ? { ...p, ...enrichedRow } : p))
            }
            return [enrichedRow, ...prev]
          })
        },
      )
      .subscribe()
    return () => {
      isMounted = false
      try { if (channel) supabase.removeChannel(channel) } catch {}
    }
  }, [])

  // Side panel removed; no click-outside handler

  // Opportunistic sweeper: no cron dependency. If any pick is past expires_at
  // and still marked 'open', ping the pick-manager edge function to flip it.
  useEffect(() => {
    let timer
    const callSweeperIfDue = async () => {
      try {
        if (!Array.isArray(players) || players.length === 0) return
        const now = Date.now()
        const hasDue = players.some(p => p && p.status === 'open' && p.expires_at && (new Date(p.expires_at).getTime() <= now))
        if (!hasDue) return
        const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
        const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
        if (!base) return
        await fetch(`${base}/functions/v1/pick-manager`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(anon ? { 'apikey': anon, 'Authorization': `Bearer ${anon}` } : {}),
          },
          body: JSON.stringify({ reason: 'ui-detected-due' }),
        }).catch(() => {})
      } catch (_) { /* ignore */ }
    }
    // Check every 10s and once shortly after load
    timer = setInterval(callSweeperIfDue, 10000)
    const boot = setTimeout(callSweeperIfDue, 3000)
    return () => { if (timer) clearInterval(timer); clearTimeout(boot) }
  }, [players])

  return (
    <NowProvider>
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <div className={`transition-all duration-300`}>
        <div className="container mx-auto px-4 pb-24">
          <div className="max-w-3xl mx-auto mt-4">
            {/* How-it-works card removed; content now shown via header modal */}
            {/* Center create prediction button removed (sidebar CTA remains) */}
          </div>
          {/* Page-level search removed; header search is primary */}
          <div className="mt-2" />
          {loading ? (
            <div className="text-gray-secondary py-10">Loading picks…</div>
          ) : displayedPlayers.length ? (
            <PlayerGrid
              onPlayerSelection={handlePlayerSelection}
              players={displayedPlayers}
              onCardClick={(player) => navigate(`/pick/${player.id}`)}
              activePlayerId={null}
              variant="home"
            />
          ) : (
            <div className="text-gray-secondary py-10 text-center">
              No picks found for <span className="text-white">{activeCategoryFilter?.label || 'this filter'}</span> yet.
            </div>
          )}
        </div>
        <Footer />
      </div>

      <AddPlayerModal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); if (location.search.includes('new=1')) navigate('/home', { replace: true }) }}
        onAddPlayer={handleAddPlayer}
      />

      {/* Side DetailPanel removed in favor of /pick/:id */}
      {showLaunchProgress && (
        <LaunchProgress percent={launchPct} message={launchMsg} onCancel={() => setShowLaunchProgress(false)} />
      )}
    </div>
    </NowProvider>
  )
}

export default Home

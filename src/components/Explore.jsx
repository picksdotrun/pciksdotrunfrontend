import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdvancedPanels from './AdvancedPanels'
import { supabase } from '../lib/supabase'
import { enrichPicksWithCreators } from '../lib/enrichCreators'
import { useProfile } from '../lib/useProfile'
import { formatVolumeDisplay, formatUsdVolume } from '../lib/volumeFormat'

const CATEGORY_FILTERS = [
  { id: 'politics', label: 'Politics' },
  { id: 'sports', label: 'Sports' },
  { id: 'culture', label: 'Culture' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'climate', label: 'Climate' },
  { id: 'economics', label: 'Economics' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'companies', label: 'Companies' },
  { id: 'financials', label: 'Financials' },
  { id: 'tech-science', label: 'Tech & Science' },
  { id: 'health', label: 'Health' },
  { id: 'world', label: 'World' },
]

const FILTERS = [
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
  { id: 'all', label: 'All' },
  ...CATEGORY_FILTERS,
  { id: 'following', label: 'Following' },
]

const FILTER_DESCRIPTIONS = {
  trending: 'See which prediction markets the Picks community is buzzing about right now.',
  new: 'Discover newly launched prediction markets and follow your creators.',
  all: 'Browse every active Picks market without any filters.',
}

const CATEGORY_LABEL_LOOKUP = CATEGORY_FILTERS.reduce((map, filter) => {
  map[filter.id] = filter.label
  return map
}, {})

const parseFollowingList = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export default function Explore() {
  const { walletAddress, profile } = useProfile()
  const navigate = useNavigate()
  const [isAdvanced, setIsAdvanced] = useState(false)
  const [filter, setFilter] = useState('new')
  const [loading, setLoading] = useState(true)
  const [picks, setPicks] = useState([])
  const [amounts, setAmounts] = useState({})
  const [error, setError] = useState(null)
  const [showCreators, setShowCreators] = useState(false)
  const [creators, setCreators] = useState([])
  const [creatorLoading, setCreatorLoading] = useState(false)
  const [creatorError, setCreatorError] = useState(null)

  const fetchPicks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: queryError } = await supabase
        .from('picks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(80)
      if (queryError) throw queryError
      const enriched = await enrichPicksWithCreators(Array.isArray(data) ? data : [])
      setPicks(enriched)
    } catch (err) {
      console.error('[Explore] failed to load picks', err)
      setError(err)
      setPicks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPicks()
  }, [fetchPicks])

  useEffect(() => {
    const channel = supabase
      .channel('explore-picks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, () => {
        fetchPicks()
      })
      .subscribe()
    return () => {
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [fetchPicks])

  const followingIds = useMemo(() => parseFollowingList(profile?.following || profile?.following_list).map((entry) => entry.id), [profile?.following, profile?.following_list])

  const filteredPicks = useMemo(() => {
    if (filter === 'trending') {
      return [...picks].sort((a, b) => (b.volume_24h || 0) - (a.volume_24h || 0))
    }
    if (filter === 'new') {
      return [...picks].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    }
    if (filter === 'following') {
      if (!followingIds.length) return []
      return picks.filter((pick) => pick.creator_id && followingIds.includes(pick.creator_id))
    }
    if (filter === 'all') {
      return picks
    }
    const categoryLabel = CATEGORY_LABEL_LOOKUP[filter]
    if (categoryLabel) {
      return picks.filter((pick) => (pick.category || '').toLowerCase() === categoryLabel.toLowerCase())
    }
    return picks
  }, [filter, picks, followingIds])

  const onAmountChange = (pickId) => (event) => {
    const value = event.target.value
    setAmounts((prev) => ({ ...prev, [pickId]: value }))
  }

  useEffect(() => {
    if (!showCreators) return
    let cancelled = false
    ;(async () => {
      setCreatorLoading(true)
      setCreatorError(null)
      try {
        const { data, error: creatorFetchError } = await supabase
          .from('users')
          .select('id, wallet, username, display_name, avatar_url, bio, followers_count, picks_count, trading_volume_wei, win_count, loss_count')
          .order('followers_count', { ascending: false })
          .limit(100)
        if (creatorFetchError) throw creatorFetchError
        if (!cancelled) setCreators(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('[Explore] failed to load creators', err)
        if (!cancelled) {
          setCreators([])
          setCreatorError(err)
        }
      } finally {
        if (!cancelled) setCreatorLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [showCreators])

  const description = showCreators
    ? 'Browse the top Picks creators and jump directly into their prediction markets.'
    : isAdvanced
      ? 'Advanced mode unlocks rearrangeable panels so you can scout markets your way.'
      : filter === 'following' && !walletAddress
        ? 'Connect your wallet to follow creators and see their latest prediction markets here.'
        : CATEGORY_LABEL_LOOKUP[filter]
          ? `Markets tagged ${CATEGORY_LABEL_LOOKUP[filter]}.`
          : FILTER_DESCRIPTIONS[filter] || FILTER_DESCRIPTIONS.trending

  if (isAdvanced) {
    return (
      <div className="container mx-auto px-4 py-10 space-y-6">
        <ExploreHeader isAdvanced={isAdvanced} toggle={setIsAdvanced} description={description} />
        <AdvancedPanels followingWallet={walletAddress || null} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <div className="container mx-auto px-4 py-10 space-y-8">
        <ExploreHeader isAdvanced={isAdvanced} toggle={setIsAdvanced} description={description} />

        <div className="flex items-center justify-center gap-4 sm:gap-6 text-sm font-semibold flex-wrap">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`relative pb-2 transition-colors ${
                filter === id ? 'text-cyan-300' : 'text-gray-secondary hover:text-gray-200'
              }`}
            >
              {label}
              <span
                className={`absolute -bottom-1 left-0 right-0 h-[3px] rounded-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-400 shadow-[0_0_12px_rgba(110,231,183,0.55)] transition-opacity ${
                  filter === id ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          ))}
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowCreators((prev) => !prev)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
              showCreators ? 'border-cyan-400 text-cyan-200' : 'border-card-border text-gray-200 hover:border-cyan-400/60'
            }`}
          >
            <span>Explore creators</span>
            <span className={`h-2 w-2 rounded-full ${showCreators ? 'bg-cyan-300 animate-pulse' : 'bg-gray-500'}`} />
          </button>
        </div>

        {showCreators ? (
          <CreatorsList
            creators={creators}
            loading={creatorLoading}
            error={creatorError}
          />
        ) : (
        <section className="relative">
          {loading ? (
            <div className="flex flex-col gap-6">
              {[...Array(3)].map((_, idx) => (
                <div key={idx} className="h-[70vh] rounded-[2rem] border border-card-border/60 bg-surface-muted/40 animate-pulse" />
              ))}
            </div>
          ) : filteredPicks.length === 0 ? (
            <div className="text-center text-sm text-gray-secondary border border-dashed border-card-border rounded-[2rem] py-16">
              {filter === 'following'
                ? walletAddress
                  ? 'No prediction markets from creators you follow yet.'
                  : 'Connect your wallet to see predictions from creators you follow.'
                : 'No prediction markets to display yet.'}
            </div>
          ) : (
            <div className="flex flex-col gap-8 items-center">
              {filteredPicks.map((pick) => {
                const amountVal = amounts[pick.id] ?? ''
                const totalVolumeLabel = formatUsdVolume(pick?.trading_volume_wei ?? pick?.total_volume_wei)
                const showTotalVolume = totalVolumeLabel && totalVolumeLabel !== '—'
                return (
                  <article
                    key={pick.id}
                    className="w-full max-w-3xl rounded-[1.5rem] border border-card-border/70 bg-gradient-to-b from-card-bg to-card-bg/80 shadow-[0_20px_80px_-40px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col"
                  >
                    <div className="relative bg-black h-[32vh]">
                      {pick.image ? (
                        <img src={pick.image} alt={pick.name || 'Prediction'} className="h-full w-full object-cover opacity-90" />
                      ) : (
                        <div className="h-full w-full bg-gradient-to-br from-slate-900 via-slate-800 to-black flex items-center justify-center text-gray-700 uppercase tracking-[0.4em] text-sm">
                          Market preview
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
                        <div className="flex items-center gap-3 text-xs text-gray-300">
                          <span className="px-3 py-1 rounded-full border border-white/30 text-white/90">{pick.category || 'General'}</span>
                          <span>{new Date(pick.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                          <span>{(pick.status || 'open').toUpperCase()}</span>
                        </div>
                        <h3 className="mt-3 text-2xl font-semibold text-white">{pick.name || 'Untitled pick'}</h3>
                        {pick.description && (
                          <p className="mt-2 text-sm text-gray-200 line-clamp-3">{pick.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-card-bg/95">
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-200">
                        <div>
                          <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Line</div>
                          <div className="text-lg font-semibold text-white">{pick.line ?? '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.3em] text-gray-500">24h volume</div>
                          <div className="text-lg font-semibold text-white">${Number(pick.volume_24h || 0).toLocaleString()}</div>
                        </div>
                        {showTotalVolume && (
                          <div>
                            <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Total volume</div>
                            <div className="text-lg font-semibold text-white">{totalVolumeLabel} Volume</div>
                          </div>
                        )}
                        <div>
                          <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Holders</div>
                          <div className="text-lg font-semibold text-white">{Number(pick.holders_count || 0).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={amountVal}
                          onChange={onAmountChange(pick.id)}
                          className="w-28 rounded-full border border-card-border bg-dark-bg px-4 py-2 text-sm text-gray-100 focus:outline-none focus:border-green-bright"
                          placeholder="Amount"
                        />
                        <QuickBetButton navigate={navigate} pickId={pick.id} side="yes" amount={amountVal} />
                        <QuickBetButton navigate={navigate} pickId={pick.id} side="no" amount={amountVal} />
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-900/10 px-4 py-3 text-sm text-rose-200">
              Something went wrong loading markets. Please refresh.
            </div>
          )}
        </section>
        )}
      </div>
    </div>
  )
}

function ExploreHeader({ isAdvanced, toggle, description }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <h1 className="text-3xl font-bold text-white tracking-tight">Explore markets</h1>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold uppercase tracking-[0.3em] transition-colors ${isAdvanced ? 'text-gray-500' : 'text-cyan-300'}`}>Off</span>
          <button
            type="button"
            aria-pressed={isAdvanced}
            onClick={() => toggle((prev) => !prev)}
            className={`relative w-14 h-7 rounded-full border border-cyan-400/40 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 transition-all duration-200 ${
              isAdvanced ? 'ring-2 ring-cyan-400/60' : ''
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-cyan-300 shadow-[0_6px_18px_rgba(34,211,238,0.45)] transition-all duration-200 ease-out ${
                isAdvanced ? 'left-8' : 'left-1'
              }`}
            />
          </button>
          <span className={`text-xs font-semibold uppercase tracking-[0.3em] transition-colors ${isAdvanced ? 'text-cyan-300' : 'text-gray-500'}`}>On</span>
          <span
            className={`text-sm font-semibold uppercase tracking-[0.3em] transition-colors ${
              isAdvanced ? 'text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.7)]' : 'text-white/80'
            }`}
          >
            Advanced
          </span>
        </div>
      </div>
      <p className="text-gray-secondary text-sm leading-relaxed max-w-2xl">{description}</p>
    </div>
  )
}

function QuickBetButton({ navigate, pickId, side, amount }) {
  const label = side === 'yes' ? 'Yes' : 'No'
  return (
    <button
      type="button"
      onClick={() => {
        const params = new URLSearchParams()
        params.set('side', side)
        if (amount) params.set('amount', amount)
        navigate(`/pick/${pickId}?${params.toString()}`)
      }}
      className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
        side === 'yes'
          ? 'bg-green-bright/20 border-green-bright text-green-bright hover:bg-green-bright/30'
          : 'bg-transparent border-card-border text-gray-200 hover:border-green-bright/60'
      }`}
    >
      {label}
    </button>
  )
}

function CreatorsList({ creators, loading, error }) {
  const short = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[...Array(4)].map((_, idx) => (
          <div key={idx} className="h-20 rounded-2xl border border-card-border/50 bg-surface-muted/30 animate-pulse" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="text-center text-sm text-rose-200 border border-rose-500/40 rounded-2xl py-6">
        Unable to load creators. Please refresh.
      </div>
    )
  }
  if (!creators.length) {
    return (
      <div className="text-center text-sm text-gray-secondary border border-dashed border-card-border rounded-2xl py-10">
        No creators to display yet.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {creators.map((creator, idx) => {
        const displayName = creator.display_name || creator.username || short(creator.wallet)
        const volumeLabel = formatVolumeDisplay(creator.trading_volume_wei || 0)
        const winCount = Number(creator.win_count || 0)
        const lossCount = Number(creator.loss_count || 0)
        const totalTrades = winCount + lossCount
        const winRate = totalTrades ? Math.round((winCount / totalTrades) * 100) : 0
        return (
          <article
            key={creator.id || creator.wallet || idx}
            className="flex items-center gap-3 rounded-2xl border border-card-border/70 bg-card-bg/80 px-4 py-3 hover:border-green-bright/60 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-full border border-card-border">
                {creator.avatar_url ? (
                  <img src={creator.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-slate-900 via-slate-800 to-black flex items-center justify-center text-xs font-semibold text-white">
                    {displayName?.slice(0, 2)?.toUpperCase() || 'SP'}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span className="truncate">{displayName}</span>
                  {idx < 3 && (
                    <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-300">Top {idx + 1}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  Wallet: <span className="text-gray-200">{short(creator.wallet)}</span>
                </div>
                {creator.bio && (
                  <p className="text-xs text-gray-300 line-clamp-1 mt-1">{creator.bio}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end text-sm text-gray-200 text-right gap-1">
              <div className="font-semibold text-white">{Number(creator.picks_count || 0).toLocaleString()} picks</div>
              <div className="text-xs text-gray-400">{Number(creator.followers_count || 0).toLocaleString()} followers</div>
              <div className="text-xs text-cyan-200">Volume: {volumeLabel}</div>
              <div className="text-xs text-gray-300">Win rate: <span className={winRate >= 50 ? 'text-green-bright font-semibold' : 'text-rose-300 font-semibold'}>{winRate}%</span> ({winCount}W/{lossCount}L)</div>
            </div>
            <Link
              to={`/profile/${creator.wallet || ''}`}
              className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold text-gray-200 hover:border-green-bright/70"
            >
              View
            </Link>
          </article>
        )
      })}
    </div>
  )
}

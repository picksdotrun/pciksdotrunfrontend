import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import FollowButton from './FollowButton'
import TradesTable from './TradesTable'
import PicksGallery from './PicksGallery'
import InlineStat from './InlineStat'
import { formatVolumeDisplay } from '../lib/volumeFormat'

const short = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')

export default function PublicProfile() {
  const navigate = useNavigate()
  const { wallet } = useParams()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copyMsg, setCopyMsg] = useState('')
  const [walletMsg, setWalletMsg] = useState('')
  const [userPicks, setUserPicks] = useState([])
  const [activeTab, setActiveTab] = useState('posted')

  useEffect(() => {
    let mounted = true
    if (!wallet) return
    ;(async () => {
      try {
        const { data } = await supabase.from('users').select('*').eq('wallet', wallet).maybeSingle()
        if (mounted) setRow(data || null)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    const channel = supabase
      .channel(`public-profile:${wallet}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `wallet=eq.${wallet}` }, (payload) => {
        const r = payload.new || payload.record
        if (r?.wallet === wallet) setRow(r)
      })
      .subscribe()
    return () => { mounted = false; try { supabase.removeChannel(channel) } catch {} }
  }, [wallet])

  useEffect(() => {
    if (!row?.id) return undefined
    const followerChannel = supabase
      .channel(`public-followers:${row.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'follows', filter: `following_id=eq.${row.id}` },
        () => setRow((prev) => (prev ? { ...prev, followers_count: (prev.followers_count || 0) + 1 } : prev)),
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'follows', filter: `following_id=eq.${row.id}` },
        () => setRow((prev) => (prev ? { ...prev, followers_count: Math.max((prev.followers_count || 1) - 1, 0) } : prev)),
      )
      .subscribe()
    return () => { try { supabase.removeChannel(followerChannel) } catch {} }
  }, [row?.id])

  useEffect(() => {
    if (!row?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('picks')
          .select('*')
          .eq('creator_id', row.id)
          .order('created_at', { ascending: false })
          .limit(12)
        if (!cancelled) setUserPicks(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setUserPicks([])
      }
    })()
    return () => { cancelled = true }
  }, [row?.id])

  const avatarColor = useMemo(() => {
    const w = row?.wallet || wallet || ''
    if (!w) return '#39ff14'
    let hash = 0
    for (let i = 0; i < w.length; i++) hash = (hash * 31 + w.charCodeAt(i)) >>> 0
    const hue = hash % 360
    return `hsl(${hue} 85% 55%)`
  }, [row?.wallet, wallet])

  const displayName = row?.display_name || row?.username || 'Picks Predictor'
  const avatarUrl = row?.avatar_url || ''
  const bio = row?.bio || ''
  const followersCount = Number(row?.followers_count ?? 0)
  const picksPlaced = Number(row?.picks_count ?? 0)
  const joinedDate = useMemo(() => {
    if (!row?.created_at) return '—'
    return new Date(row.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }, [row?.created_at])
  const shortAddr = short(wallet)
  const tradingVolumeDisplay = useMemo(
    () => formatVolumeDisplay(row?.trading_volume_wei ?? row?.total_volume_wei),
    [row?.trading_volume_wei, row?.total_volume_wei],
  )
  const wins = Number(row?.win_count ?? 0)
  const losses = Number(row?.loss_count ?? 0)
  const totalTrades = wins + losses
  const winRate = totalTrades ? Math.round((wins / totalTrades) * 100) : 0
  const netWei = (BigInt(row?.win_amount_wei ?? 0) - BigInt(row?.loss_amount_wei ?? 0)).toString()
  const netDisplay = formatVolumeDisplay(netWei)
  const winRateHelper = totalTrades ? `${wins}W / ${losses}L • ${netDisplay}` : ''

  if (!wallet) {
    return (
      <div className="min-h-screen bg-dark-bg text-gray-100 flex items-center justify-center px-6">
        <div className="rounded-3xl border border-card-border px-6 py-8 text-center text-sm text-gray-300">
          Missing wallet address in URL.
        </div>
      </div>
    )
  }

  if (!row && !loading) {
    return (
      <div className="min-h-screen bg-dark-bg text-gray-100 flex items-center justify-center px-6">
        <div className="rounded-3xl border border-card-border px-6 py-8 text-center text-sm text-gray-300">
          This profile has not been created yet.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <div className="pt-24 pb-16 px-4">
        <div className="max-w-5xl mx-auto space-y-10">
          <section className="bg-card-bg/95 border border-card-border rounded-[2rem] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.7)] backdrop-blur-sm overflow-hidden">
            <div className="px-6 py-8 lg:px-10 lg:py-10 flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl border-2 border-green-bright/60 shadow-[0_0_30px_rgba(57,255,20,0.25)] overflow-hidden bg-surface-muted flex items-center justify-center text-2xl font-semibold">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile avatar" className="w-full h-full object-cover" />
                  ) : (
                    (displayName || 'SP').slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">{displayName}</h1>
                      {row?.x_handle && (
                        <a
                          href={`https://x.com/${row.x_handle.replace(/^@/, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-card-border px-3 py-1 text-xs text-cyan-300 hover:text-white"
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">X</span>
                          <span className="font-medium">{row.x_handle}</span>
                        </a>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-secondary">
                      <span>Joined {joinedDate}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(wallet)
                            setWalletMsg('Copied!')
                            setTimeout(() => setWalletMsg(''), 1500)
                          } catch (err) {
                            console.error('[PublicProfile] copy wallet failed', err)
                            setWalletMsg('Failed')
                            setTimeout(() => setWalletMsg(''), 1500)
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-gray-secondary hover:text-green-bright transition-colors"
                      >
                        <span className="text-gray-secondary">⧉</span>
                        <span className="text-gray-200 tracking-wide">{shortAddr}</span>
                        {walletMsg && <span className="text-green-bright">{walletMsg}</span>}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FollowButton targetUserId={row?.id} />
                    <button
                      type="button"
                      disabled={!row?.id}
                      onClick={() => navigate(row?.id ? `/messages?user=${row.id}` : '/messages')}
                      className="inline-flex items-center justify-center rounded-full border border-card-border text-sm px-6 py-2.5 text-gray-100 hover:border-cyan-400 transition-colors disabled:opacity-60 min-w-[140px]"
                    >
                      Message
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-full border border-card-border text-sm px-6 py-2.5 hover:border-green-bright transition-colors min-w-[140px]"
                      onClick={async () => {
                        try {
                          const url = `${window.location.origin}/profile/${wallet}`
                          await navigator.clipboard.writeText(url)
                          setCopyMsg('Copied!')
                          setTimeout(() => setCopyMsg(''), 1500)
                        } catch (err) {
                          console.error('[PublicProfile] copy link failed', err)
                          setCopyMsg('Failed')
                          setTimeout(() => setCopyMsg(''), 1500)
                        }
                      }}
                    >
                      {copyMsg || 'Share profile'}
                    </button>
                  </div>
                </div>
              </div>

              {bio && (
                <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {bio}
                </p>
              )}

              <div className="flex flex-wrap gap-5">
                <InlineStat label="Followers" value={followersCount.toLocaleString()} />
                <InlineStat label="Picks placed" value={picksPlaced.toLocaleString()} />
                <InlineStat label="Win rate" value={`${winRate}%`} helper={winRateHelper} />
                <InlineStat label="Trading volume" value={tradingVolumeDisplay} helper="Lifetime BNB traded" />
              </div>
            </div>
          </section>

          <section className="bg-card-bg/80 border border-card-border rounded-[1.75rem] px-8 py-8 lg:px-10 lg:py-10 shadow-[0_30px_100px_-40px_rgba(0,0,0,0.7)] space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-white tracking-tight">Prediction overview</h2>
              <nav className="flex items-center gap-6 text-sm font-semibold">
                {[
                  { id: 'posted', label: 'Posted predictions' },
                  { id: 'placed', label: 'Placed predictions' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`relative pb-2 transition-colors ${
                      activeTab === id ? 'text-cyan-300' : 'text-gray-secondary hover:text-gray-100'
                    }`}
                  >
                    {label}
                    <span
                      className={`absolute -bottom-1 left-0 right-0 h-[3px] rounded-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-400 shadow-[0_0_12px_rgba(110,231,183,0.55)] transition-opacity ${
                        activeTab === id ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  </button>
                ))}
              </nav>
            </div>
            <div className="mt-4">
              <PublicTabContent activeTab={activeTab} userPicks={userPicks} userId={row?.id || null} />
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, helper, onClick }) {
  const helperText = helper != null && helper !== '' ? helper : '\u00A0'
  const clickable = typeof onClick === 'function'
  const Component = clickable ? 'button' : 'div'
  return (
    <Component
      className={`w-full rounded-2xl border border-card-border/80 bg-surface-muted/50 px-4 py-3 text-center md:text-left ${
        clickable ? 'hover:border-green-bright/60 transition-colors text-left' : ''
      }`}
      onClick={onClick}
      type={clickable ? 'button' : undefined}
    >
      <div className="text-xs uppercase tracking-[0.2em] text-gray-secondary">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="text-[11px] text-gray-secondary">{helperText}</div>
    </Component>
  )
}

function PublicTabContent({ activeTab, userPicks, userId }) {
  if (activeTab === 'posted') return <PicksGallery picks={userPicks} emptyLabel="No posted predictions yet." />
  return (
    <TradesTable
      mode="user"
      filterId={userId}
      title="Placed predictions"
      emptyMessage="No completed trades yet. Start trading to populate this history."
      maxHeight="420px"
    />
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { launchOverUnderTokens } from '../lib/launchTokens'
import EvmTradePanel from '../components/EvmTradePanel'
import { useProfile } from '../lib/useProfile'
import { formatUnits } from '../lib/evm'
import TradesTable from '../components/TradesTable'
import { formatVolumeDisplay } from '../lib/volumeFormat'
import PickPriceChart from '../components/PickPriceChart'

export default function PickPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { authenticated, profile, login } = useProfile()
  const [pick, setPick] = useState(null)
  const [loading, setLoading] = useState(true)
  const [amountSol, setAmountSol] = useState(0.1)
  const [launching, setLaunching] = useState(false)
  const [swapping, setSwapping] = useState(null)
  const [tab, setTab] = useState('comments') // comments | activity
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareSelected, setShareSelected] = useState([])
  const [shareError, setShareError] = useState('')
  const [shareSending, setShareSending] = useState(false)
  const [creatorProfile, setCreatorProfile] = useState(null)
  const [creatorDeployCount, setCreatorDeployCount] = useState(null)
  const [marketStats, setMarketStats] = useState(null)
  const userCacheRef = useRef(new Map())

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase.from('picks').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (mounted) setPick(data)
      } catch (e) {
        console.error('Failed to load pick', e)
      } finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [id])

  useEffect(() => {
    if (!pick?.creator_id && !pick?.creator_wallet) {
      setCreatorProfile(null)
      setCreatorDeployCount(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        let profile = null
        if (pick?.creator_id) {
          const { data } = await supabase
            .from('users')
            .select('id, display_name, username, avatar_url, wallet, picks_count')
            .eq('id', pick.creator_id)
            .maybeSingle()
          profile = data || null
        } else if (pick?.creator_wallet) {
          const { data } = await supabase
            .from('users')
            .select('id, display_name, username, avatar_url, wallet, picks_count')
            .eq('wallet', pick.creator_wallet)
            .maybeSingle()
          profile = data || null
        }
        if (!profile && pick?.creator_wallet) {
          profile = { wallet: pick.creator_wallet }
        }
        let deployments = profile?.picks_count ?? null
        const lookupId = profile?.id || pick?.creator_id || null
        if (!deployments && lookupId) {
          const { count } = await supabase
            .from('picks')
            .select('id', { count: 'exact', head: true })
            .eq('creator_id', lookupId)
          deployments = typeof count === 'number' ? count : null
        }
        if (!cancelled) {
          setCreatorProfile(profile)
          setCreatorDeployCount(deployments)
        }
      } catch (err) {
        if (!cancelled) {
          setCreatorProfile(pick?.creator_wallet ? { wallet: pick.creator_wallet } : null)
          setCreatorDeployCount(null)
        }
      }
    })()
    return () => { cancelled = true }
  }, [pick?.creator_id, pick?.creator_wallet])

  const lessMintCA = pick?.lessToken ?? pick?.lesstoken ?? null
  const moreMintCA = pick?.moreToken ?? pick?.moretoken ?? null
  const expiresAt = pick?.expires_at ? new Date(pick.expires_at) : null
  const evmMarket = pick?.evm_market_address || null
  const formatDateTime = (d) => d ? new Date(d).toLocaleString() : 'Not set'

  const ensureTokensLaunched = async () => {
    if (lessMintCA && moreMintCA) return { lessMint: lessMintCA, moreMint: moreMintCA }
    if (!pick) return { lessMint: null, moreMint: null }
    setLaunching(true)
    try {
      const result = await launchOverUnderTokens({
        pickId: pick.id,
        name: pick.name,
        line: pick.line,
        category: pick.category,
        description: pick.description,
        image: pick.image,
      })
      setPick((p) => p ? { ...p, lesstoken: result.lessMint, moretoken: result.moreMint, lessToken: result.lessMint, moreToken: result.moreMint } : p)
      return result
    } finally { setLaunching(false) }
  }

  const onSwap = async (side) => {
    try {
      setSwapping(side)
      const res = await ensureTokensLaunched()
      const { swapSolToMint } = await import('../lib/swap')
      const toMint = (side === 'less' ? (lessMintCA || res.lessMint) : (moreMintCA || res.moreMint))
      if (!toMint) return
      const amt = Number(amountSol) || 0.01
      const sig = await swapSolToMint({ toMint, amountSol: amt, slippage: 10 })
      // Log trade
      try {
        const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
        const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
        if (base && anon) {
          await fetch(`${base}/functions/v1/log-trade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anon}`, 'apikey': anon },
            body: JSON.stringify({ pickId: pick.id, userWallet: (userWallet || ''), side, amountSol: amt }),
          })
        }
      } catch (_) {}
    } catch (e) {
      console.error('[Picks][Solana] swap error', e)
      alert(e?.message || 'Swap failed')
    } finally {
      setSwapping(null)
    }
  }

  const fetchCommentUser = useCallback(async (userId) => {
    if (!userId) return null
    if (userCacheRef.current.has(userId)) return userCacheRef.current.get(userId)
    const { data } = await supabase
      .from('users')
      .select('id, username, display_name, avatar_url, wallet')
      .eq('id', userId)
      .maybeSingle()
    if (data) userCacheRef.current.set(userId, data)
    return data || null
  }, [])

  const decorateComment = useCallback(async (row) => {
    if (!row) return null
    if (row.user) return { ...row, user: row.user }
    const user = await fetchCommentUser(row.user_id)
    return { ...row, user }
  }, [fetchCommentUser])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setCommentsLoading(true)
    setCommentError('')
    ;(async () => {
      try {
        const { data, error: commentsError } = await supabase
          .from('post_comments')
          .select('id, content, created_at, user_id, user:users!post_comments_user_id_fkey(id, username, display_name, avatar_url, wallet)')
          .eq('pick_id', id)
          .order('created_at', { ascending: false })
        if (commentsError) throw commentsError
        const enriched = await Promise.all(
          (data || []).map(async (row) => decorateComment(row)),
        )
        if (!cancelled) setComments(enriched.filter(Boolean))
      } catch (err) {
        console.error('[PickPage] load comments failed', err)
        if (!cancelled) {
          setComments([])
          setCommentError(err?.message || 'Failed to load comments')
        }
      } finally {
        if (!cancelled) setCommentsLoading(false)
      }
    })()
    const channel = supabase
      .channel(`post-comments:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments', filter: `pick_id=eq.${id}` }, async (payload) => {
        const row = payload.new || payload.record
        if (!row) return
        if (payload.eventType === 'INSERT') {
          const decorated = await decorateComment(row)
          setComments((prev) => decorated ? [decorated, ...prev] : prev)
        } else if (payload.eventType === 'UPDATE') {
          const decorated = await decorateComment(row)
          setComments((prev) => prev.map((item) => (item.id === row.id ? decorated : item)))
        } else if (payload.eventType === 'DELETE') {
          setComments((prev) => prev.filter((item) => item.id !== row.id))
        }
      })
      .subscribe()
    return () => {
      cancelled = true
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [id, decorateComment])


  const handleCommentSubmit = async (event) => {
    event.preventDefault()
    if (!authenticated) {
      setCommentError('Connect your wallet to join the discussion.')
      return
    }
    if (!profile?.id) {
      setCommentError('Complete your profile before commenting.')
      return
    }
    const trimmed = commentText.trim()
    if (!trimmed) {
      setCommentError('Please enter a comment before posting.')
      return
    }
    setCommentError('')
    setCommentSubmitting(true)
    try {
      await supabase
        .from('post_comments')
        .insert({ pick_id: id, user_id: profile.id, content: trimmed })
      setCommentText('')
    } catch (err) {
      console.error('[PickPage] failed to post comment', err)
      setCommentError(err?.message || 'Unable to post comment right now.')
    } finally {
      setCommentSubmitting(false)
    }
  }

  const shortAddress = useCallback((value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—'), [])
  const formatRelativeTime = (dateValue) => {
    if (!dateValue) return ''
    const date = new Date(dateValue)
    const diff = Date.now() - date.getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString()
  }
  const pickVolumeDisplay = useMemo(
    () => formatVolumeDisplay(pick?.trading_volume_wei ?? pick?.total_volume_wei),
    [pick?.trading_volume_wei, pick?.total_volume_wei],
  )
  const [tradesMeta, setTradesMeta] = useState({ trades: null, volumeLabel: null })
  const tradesDisplay = Number.isFinite(tradesMeta?.trades) ? tradesMeta.trades.toLocaleString() : '0'
  const sidebarVolumeLabel = pickVolumeDisplay ? `${pickVolumeDisplay} Volume` : '—'
  const holderCount = Number(pick?.holders_count ?? pick?.holders ?? 0)
  const holderDisplay = Number.isFinite(holderCount) ? holderCount.toLocaleString() : '0'
  const creatorWallet = (creatorProfile?.wallet || pick?.creator_wallet || '').toLowerCase()
  const creatorDisplayName = creatorProfile?.display_name || creatorProfile?.username || (creatorWallet ? shortAddress(creatorWallet) : 'Unknown creator')
  const creatorAvatar = creatorProfile?.avatar_url || ''
  const creatorDeploymentsLabel = creatorDeployCount != null ? `${creatorDeployCount} deployed` : '—'
  const totalPooledLabel = useMemo(() => {
    if (!marketStats) return '—'
    const total = (marketStats.vaultYes || 0n) + (marketStats.vaultNo || 0n)
    const parsed = Number(formatUnits(total, 18))
    if (!Number.isFinite(parsed) || parsed === 0) return '—'
    const digits = parsed >= 1 ? 3 : 5
    return `${parsed.toFixed(digits)} BNB`
  }, [marketStats])
  const parseRelationshipList = useCallback((value) => {
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
  }, [])

  const followingList = useMemo(() => parseRelationshipList(profile?.following), [profile?.following, parseRelationshipList])
  const [followingDetails, setFollowingDetails] = useState([])
  const [walletSnapshot, setWalletSnapshot] = useState(null)
  const tradesSectionRef = useRef(null)
  const handleTradesStatClick = useCallback(() => {
    setTab('trades')
    try {
      tradesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch {}
  }, [])

  useEffect(() => {
    if (!followingList.length) {
      setFollowingDetails([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const ids = followingList.map((entry) => entry.id)
        const { data, error } = await supabase
          .from('users')
          .select('id, display_name, username, avatar_url, wallet')
          .in('id', ids)
        if (error) throw error
        if (!cancelled) {
          const dataMap = new Map((data || []).map((row) => [row.id, row]))
          setFollowingDetails(
            followingList.map((entry) => {
              const detail = dataMap.get(entry.id)
              const screenName =
                entry.screen_name ||
                detail?.display_name ||
                detail?.username ||
                shortAddress(detail?.wallet)
              return {
                id: entry.id,
                screen_name: screenName,
                avatar_url: detail?.avatar_url || null,
                wallet: detail?.wallet || null,
              }
            }),
          )
        }
      } catch (err) {
        console.error('[PickPage] load following details failed', err)
        if (!cancelled) setFollowingDetails([])
      }
    })()
    return () => { cancelled = true }
  }, [followingList, shortAddress])

  const openShareModal = () => {
    if (!authenticated) {
      setShareError('Connect your wallet to share picks.')
    } else {
      setShareError('')
    }
    const initial = followingDetails.slice(0, 5).map((entry) => entry.id)
    setShareSelected(initial)
    setShareModalOpen(true)
  }

  const toggleSelectFollowing = (id) => {
    setShareSelected((prev) => {
      if (prev.includes(id)) return prev.filter((entry) => entry !== id)
      if (prev.length >= 5) return prev
      return [...prev, id]
    })
  }

  const handleSelectAllFollowing = () => {
    if (shareSelected.length === Math.min(followingDetails.length, 5)) {
      setShareSelected([])
    } else {
      setShareSelected(followingDetails.slice(0, 5).map((entry) => entry.id))
    }
  }

  const handleSharePick = async () => {
    if (!authenticated || !profile?.id) {
      setShareError('Connect your wallet and complete your profile first.')
      return
    }
    if (!shareSelected.length) {
      setShareError('Select at least one person to share with.')
      return
    }
    setShareError('')
    setShareSending(true)
    try {
      const payloads = shareSelected.slice(0, 5).map((recipientId) => ({
        sender_id: profile.id,
        recipient_id: recipientId,
        body: `PICK:${id}`,
      }))
      const { error } = await supabase.from('direct_messages').insert(payloads)
      if (error) throw error
      setShareModalOpen(false)
      setShareSelected([])
    } catch (err) {
      console.error('[PickPage] share pick failed', err)
      setShareError(err?.message || 'Unable to share pick right now.')
    } finally {
      setShareSending(false)
    }
  }

  if (loading) return null
  if (!pick) return null

  const yesPriceRaw = pick?.evm_last_price_yes ?? pick?.last_price_yes ?? pick?.yes_price ?? null
  const noPriceRaw = pick?.evm_last_price_no ?? pick?.last_price_no ?? pick?.no_price ?? null
  const yesOutcomeLabel = pick?.yes_label ?? pick?.yesLabel ?? pick?.less_label ?? null
  const yesOutcomeValue = pick?.yes_value ?? pick?.yesValue ?? null
  const noOutcomeLabel = pick?.no_label ?? pick?.noLabel ?? pick?.more_label ?? null
  const noOutcomeValue = pick?.no_value ?? pick?.noValue ?? null
  const hasOutcomeValue = (val) => val !== null && val !== undefined && String(val).trim() !== ''
  const hasOutcomeRows = hasOutcomeValue(yesOutcomeLabel) || hasOutcomeValue(yesOutcomeValue) || hasOutcomeValue(noOutcomeLabel) || hasOutcomeValue(noOutcomeValue)
  const normalizePrice = (value) => {
    if (value == null) return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    return num > 1 ? num : num * 100
  }

  const yesPrice = normalizePrice(yesPriceRaw)
  const noPrice = normalizePrice(noPriceRaw)
  const yesLabel = yesPrice != null ? `${Math.round(yesPrice)}¢` : '—'
  const noLabel = noPrice != null ? `${Math.round(noPrice)}¢` : '—'
  const yesProbLabel = yesPrice != null ? `${Math.round(yesPrice)}%` : null
  const noProbLabel = noPrice != null ? `${Math.round(noPrice)}%` : null
  const yesOutcomeTitle = hasOutcomeValue(yesOutcomeLabel) ? yesOutcomeLabel : 'Yes outcome'
  const noOutcomeTitle = hasOutcomeValue(noOutcomeLabel) ? noOutcomeLabel : 'No outcome'
  const yesOutcomeMetric = hasOutcomeValue(yesOutcomeValue) ? yesOutcomeValue : '—'
  const noOutcomeMetric = hasOutcomeValue(noOutcomeValue) ? noOutcomeValue : '—'
  const yesOddsCopy = yesProbLabel || (yesLabel !== '—' ? yesLabel : null)
  const noOddsCopy = noProbLabel || (noLabel !== '—' ? noLabel : null)
  const dominantOddsLabel = (() => {
    if (yesPrice != null && noPrice != null) {
      return yesPrice >= noPrice ? (yesOddsCopy ? `Yes ${yesOddsCopy}` : null) : (noOddsCopy ? `No ${noOddsCopy}` : null)
    }
    if (yesOddsCopy) return `Yes ${yesOddsCopy}`
    if (noOddsCopy) return `No ${noOddsCopy}`
    return null
  })()

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-white font-sans">
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-12 py-6 lg:py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white text-sm inline-flex items-center gap-2">
            <span className="text-lg leading-none">←</span>
            Back
          </button>
          {dominantOddsLabel && (
            <div className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">{dominantOddsLabel}</div>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_420px] xl:grid-cols-[minmax(0,1.2fr)_520px] gap-6 rounded-[2.25rem] border border-white/5 bg-neutral-950 shadow-[0_40px_120px_-60px_rgba(0,0,0,0.9)]">
          {/* Left panel */}
          <div className="text-white px-6 sm:px-10 py-8 sm:py-10 space-y-10">
            <div className="flex flex-col lg:flex-row items-start gap-8">
              <div className="w-full max-w-[140px] mx-auto lg:mx-0">
                <div className="aspect-square rounded-2xl overflow-hidden bg-neutral-800 shadow-[0_30px_60px_-40px_rgba(0,0,0,0.9)]">
                  {pick.image ? (
                    <img src={pick.image} alt={pick.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-neutral-800" />
                  )}
                </div>
              </div>
              <div className="flex-1 space-y-3 text-left">
                <div className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">{pick.category || 'Prediction market'}</div>
                <h1 className="text-3xl lg:text-4xl font-bold leading-tight text-white">{pick.name}</h1>
                <div className="text-sm text-gray-400">
                  <span className="font-semibold text-white/80">Line:</span> {pick.line ?? '—'}
                </div>
                <div className="flex flex-wrap gap-6 text-xs uppercase tracking-[0.25em] text-gray-500">
                  <span>Created {pick.created_at ? new Date(pick.created_at).toLocaleDateString() : '—'}</span>
                  <span>Expires {expiresAt ? formatDateTime(expiresAt) : 'Not set'}</span>
                </div>
              </div>
            </div>
            <div className="grid gap-5 text-sm md:grid-cols-3">
              <InfoStat label="Volume" value={pickVolumeDisplay} />
              <InfoStat label="Trades" value={tradesDisplay} onClick={handleTradesStatClick} />
              <InfoStat label="Expires" value={expiresAt ? formatDateTime(expiresAt) : '—'} />
            </div>

            <div className="rounded-3xl border border-transparent bg-transparent transition-colors duration-200 hover:border-white/10 hover:bg-neutral-900/40 px-4 py-4">
              <PickPriceChart pickId={pick?.id} />
            </div>

            <section ref={tradesSectionRef} className="space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3 text-sm font-semibold flex-wrap">
                <div className="flex items-center gap-6">
                  {['comments', 'trades'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className={`relative pb-2 uppercase tracking-[0.25em] transition-colors ${tab === key ? 'text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      {key === 'comments' ? 'Comments' : 'Trades'}
                      <span
                        className={`absolute -bottom-[6px] left-0 right-0 h-[3px] rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.45)] transition-opacity ${
                          tab === key ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>Share</span>
                  <button
                    type="button"
                    onClick={openShareModal}
                    className="rounded-full border border-cyan-300 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
                  >
                    Share pick
                  </button>
                </div>
              </div>
              {tab === 'comments' ? (
                <div className="space-y-4">
                  {authenticated ? (
                    <form onSubmit={handleCommentSubmit} className="rounded-2xl border border-white/10 bg-neutral-900/40 px-5 py-4 space-y-3">
                      <textarea
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value)}
                        rows={3}
                        placeholder="Share your thoughts about this market…"
                        className="w-full rounded-2xl border border-white/10 bg-neutral-950/70 px-4 py-3 text-sm text-white/90 placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/70"
                      />
                      <div className="flex items-center justify-between text-xs">
                        {commentError && <span className="text-rose-300">{commentError}</span>}
                        <button
                          type="submit"
                          disabled={commentSubmitting}
                          className="inline-flex items-center gap-2 rounded-full bg-cyan-400/20 border border-cyan-300 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/30 disabled:opacity-60"
                        >
                          {commentSubmitting ? 'Posting…' : 'Post comment'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-neutral-900/40 px-5 py-4 text-sm text-gray-300 flex flex-col gap-3">
                      <span>Connect your wallet to join this discussion.</span>
                      <button
                        type="button"
                        onClick={async () => { try { await login?.() } catch (err) { console.error('[PickPage] login failed', err) } }}
                        className="self-start rounded-full border border-cyan-300 px-4 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-300/10"
                      >
                        Connect wallet
                      </button>
                    </div>
                  )}
                  {commentsLoading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, idx) => (
                        <div key={idx} className="flex gap-3">
                          <div className="h-10 w-10 rounded-full bg-white/5 animate-pulse" />
                          <div className="flex-1 space-y-2">
                            <div className="h-3 w-1/3 rounded bg-white/5 animate-pulse" />
                            <div className="h-3 w-2/3 rounded bg-white/5 animate-pulse" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : comments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/15 px-5 py-6 text-center text-sm text-gray-400">
                      No comments yet. Be the first to weigh in on this market.
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[320px] overflow-y-auto pr-1">
                      {comments.map((comment) => {
                        const displayName = comment?.user?.display_name || comment?.user?.username || shortAddress(comment?.user?.wallet)
                        const avatarUrl = comment?.user?.avatar_url || ''
                        return (
                          <div key={comment.id} className="flex gap-3">
                            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-black">
                              {avatarUrl
                                ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                                : <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white">{displayName?.slice(0, 2)?.toUpperCase() || 'SP'}</div>}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <span className="text-sm font-semibold text-white truncate">{displayName}</span>
                                <span>{formatRelativeTime(comment.created_at)}</span>
                              </div>
                              <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <TradesTable filterId={id} mode="pick" title="Trades" onMeta={setTradesMeta} />
              )}
            </section>

            {hasOutcomeRows && (
              <div className="space-y-3">
                <OutcomeRow
                  variant="yes"
                  description={hasOutcomeValue(yesOutcomeValue) ? yesOutcomeValue : 'Outcome details coming soon.'}
                />
                <OutcomeRow
                  variant="no"
                  description={hasOutcomeValue(noOutcomeValue) ? noOutcomeValue : 'Outcome details coming soon.'}
                />
              </div>
            )}

            {pick.description && (
              <section className="rounded-3xl border border-transparent bg-transparent px-6 py-6 space-y-2 transition-colors duration-200 hover:border-white/10 hover:bg-neutral-900/40">
                <h2 className="text-xs uppercase tracking-[0.3em] text-gray-400">Market overview</h2>
                <p className="text-sm text-white/80 whitespace-pre-wrap">{pick.description}</p>
              </section>
            )}

            <section className="rounded-3xl border border-transparent bg-transparent px-6 py-6 space-y-3 transition-colors duration-200 hover:border-white/10 hover:bg-neutral-900/40">
              <h2 className="text-xs uppercase tracking-[0.3em] text-gray-400">Rules</h2>
              <ul className="text-sm text-white/80 space-y-2 list-disc list-inside">
                <li>Expiration: {expiresAt ? formatDateTime(expiresAt) : 'Not set'}</li>
                <li>Outcome moderation: Evaluated using verifiable event data.</li>
                <li>Primary sources: {pick?.moderation_source || 'Official league statistics and reputable data providers'}.</li>
                <li>Fees: Winning token holders receive accumulated trading fees after resolution.</li>
              </ul>
            </section>
          </div>

          {/* Right panel */}
          <div className="border-t border-white/5 bg-neutral-950/80 px-6 sm:px-8 py-8 sm:py-10 lg:border-t-0 lg:border-l flex flex-col">
            <section className="rounded-[1.75rem] border border-white/10 bg-neutral-900/60 px-4 sm:px-6 xl:px-7 py-5 sm:py-6 shadow-[0_30px_80px_-60px_rgba(0,0,0,0.9)] flex flex-col gap-5 sm:gap-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-black mx-auto sm:mx-0">
                    {pick?.image ? (
                      <img src={pick.image} alt={pick.name || 'Market preview'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.4em] text-gray-500">
                        Preview
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <div className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Market rules</div>
                    <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                      {pick?.description?.trim() ? pick.description : 'No rules have been provided for this market.'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-gray-300">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); if (creatorWallet) navigate(`/profile/${creatorWallet}`) }}
                    className={`flex items-center gap-3 ${creatorWallet ? 'hover:opacity-90' : 'opacity-60 cursor-default'}`}
                  >
                    <div className="h-10 w-10 overflow-hidden rounded-xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-800 to-black text-sm font-semibold text-white flex items-center justify-center">
                      {creatorAvatar ? (
                        <img src={creatorAvatar} alt={creatorDisplayName} className="h-full w-full object-cover" />
                      ) : (
                        creatorDisplayName?.slice(0, 2)?.toUpperCase() || 'SP'
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-gray-400">
                      <span>Created by</span>
                      <span className="text-sm font-semibold text-white tracking-normal uppercase">{creatorDisplayName}</span>
                      {creatorDeployCount != null && (
                        <span className="text-xs text-gray-500 tracking-normal">{creatorDeploymentsLabel}</span>
                      )}
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {evmMarket ? (
                  <EvmTradePanel pick={pick} onMarketStats={setMarketStats} onWalletSnapshot={setWalletSnapshot} />
                ) : (
                  <div className="text-xs text-white/70">
                    Trading will open after this market is launched on-chain. Check back soon.
                  </div>
                )}

                {evmMarket && (
                  <div className="text-[11px] text-gray-500 leading-relaxed space-y-1 break-words">
                    <div>Market: <span className="break-all text-white/70">{evmMarket}</span></div>
                    <div className="pt-2 space-y-1 text-white/80">
                      <div>BNB: {walletSnapshot?.bnb ?? '—'}</div>
                      <div>YES Shares: {walletSnapshot?.yesShares ?? '—'}</div>
                      <div>NO Shares: {walletSnapshot?.noShares ?? '—'}</div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl bg-card-bg border border-card-border shadow-2xl shadow-black/60 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-card-border/60">
              <div>
                <h3 className="text-lg font-semibold text-white">Share pick</h3>
                <p className="text-xs text-gray-400">Select up to 5 people to notify</p>
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-white text-xl leading-none"
                onClick={() => {
                  setShareModalOpen(false)
                  setShareSelected([])
                  setShareError('')
                }}
              >
                ×
              </button>
            </div>
            <div className="px-5 py-3 flex items-center justify-between border-b border-card-border/50">
              <span className="text-sm text-gray-200">Following ({followingDetails.length})</span>
              <button
                type="button"
                onClick={handleSelectAllFollowing}
                className="text-xs text-cyan-200 hover:text-cyan-100"
              >
                {shareSelected.length === Math.min(followingDetails.length, 5) ? 'Clear' : 'Select all'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {followingDetails.length === 0 ? (
                <p className="text-sm text-gray-400 text-center">No following to share with yet.</p>
              ) : (
                followingDetails.map((entry) => {
                  const checked = shareSelected.includes(entry.id)
                  const disabled = !checked && shareSelected.length >= 5
                  return (
                    <label
                      key={entry.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                        checked ? 'border-green-bright/70 bg-green-bright/10' : 'border-card-border/70 bg-surface-muted/40'
                      } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectFollowing(entry.id)}
                        disabled={disabled}
                      />
                      <div className="h-9 w-9 rounded-full border border-card-border overflow-hidden bg-surface-muted/50 flex items-center justify-center text-sm font-semibold text-white">
                        {entry.avatar_url ? (
                          <img src={entry.avatar_url} alt={entry.screen_name} className="h-full w-full object-cover" />
                        ) : (
                          entry.screen_name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">{entry.screen_name}</p>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
            {shareError && <div className="px-5 text-xs text-rose-300">{shareError}</div>}
            <div className="px-5 py-4 border-t border-card-border/60 flex items-center justify-end gap-3">
              <button
                type="button"
                className="text-sm text-gray-400 hover:text-white"
                onClick={() => {
                  setShareModalOpen(false)
                  setShareSelected([])
                  setShareError('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSharePick}
                disabled={shareSending || shareSelected.length === 0}
                className="rounded-full bg-cyan-400/20 border border-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/30 disabled:opacity-50"
              >
                {shareSending ? 'Sharing…' : 'Share pick'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoStat({ label, value, onClick }) {
  const clickable = typeof onClick === 'function'
  const handleKeyDown = (event) => {
    if (!clickable) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick?.()
    }
  }
  return (
    <div
      className={`rounded-2xl border border-transparent bg-transparent px-4 py-4 transition-colors duration-200 hover:border-white/8 hover:bg-neutral-900/40 ${clickable ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function OutcomeRow({ variant, description }) {
  const isYes = variant === 'yes'
  const buttonClasses = isYes
    ? 'bg-[#5ED4FF] text-white shadow-lg shadow-cyan-500/30'
    : 'bg-[#FF4F8B] text-white shadow-lg shadow-rose-500/30'
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-transparent bg-transparent px-5 py-4 transition-colors duration-200 hover:border-white/10 hover:bg-neutral-900/40">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-xs uppercase tracking-[0.3em] text-gray-500">{isYes ? 'Yes' : 'No'}</div>
        <div className="text-sm text-white/90">{description}</div>
      </div>
      <button
        type="button"
        disabled
        className={`relative overflow-hidden px-6 py-3 rounded-[1.25rem] text-2xl font-semibold transition-transform ${buttonClasses} opacity-70`}
      >
        <span className="relative z-10">{isYes ? 'Yes' : 'No'}</span>
      </button>
    </div>
  )
}

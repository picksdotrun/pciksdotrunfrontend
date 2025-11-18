import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { NowProvider, useNow } from '../lib/NowContext'
import { startXOauthSignIn, exchangeCodeForToken, consumeXOauthCallbackPayload } from '../lib/xAuth'
import { useProfile } from '../lib/useProfile'
const normalizeOutcomeValue = (value) => {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (raw === 'less' || raw === 'yes') return 'yes'
  if (raw === 'more' || raw === 'no') return 'no'
  if (raw === 'void') return 'void'
  return null
}

export default function ClaimRewards() {
  return (
    <NowProvider intervalMs={1000}>
      <ClaimRewardsContent />
    </NowProvider>
  )
}

function ClaimRewardsContent() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [picks, setPicks] = useState([])
  const [showOnlyActive, setShowOnlyActive] = useState(false)
  const nowMs = useNow()
  const { authenticated, login, privyUserId, profile, fetchProfile } = useProfile()
  const [eligibilityModal, setEligibilityModal] = useState(null)
  const [checkingPickId, setCheckingPickId] = useState(null)
  const [claimingShares, setClaimingShares] = useState(false)
  const [claimError, setClaimError] = useState(null)
  const [pendingXOauth, setPendingXOauth] = useState(null)
  const [linkingX, setLinkingX] = useState(false)
  const [linkError, setLinkError] = useState(null)

  const handleConnectX = useCallback(async () => {
    try {
      setLinkError(null)
      if (!authenticated) {
        await login()
        return
      }
      if (!privyUserId) throw new Error('Missing Privy session. Please reconnect and try again.')
      await startXOauthSignIn({ privyUserId })
    } catch (err) {
      console.error('[ClaimRewards] X connection failed', err)
      alert(err?.message || 'Unable to start X authorization. Please try again.')
    }
  }, [authenticated, login, privyUserId])

  const handleCheckEligibility = useCallback(
    async (pick) => {
      if (!authenticated) {
        await login()
        return
      }
      if (!profile?.x_handle) {
        await handleConnectX()
        return
      }
      if (!pick?.x_tweet_id) {
        alert('This prediction has not been linked to its X poll yet. Please try again soon.')
        return
      }
      if (!profile?.id && !profile?.wallet) {
        alert('Please finish connecting your wallet profile before claiming.')
        return
      }
      setCheckingPickId(pick.id)
      try {
        const payload = {
          pickId: pick.id,
          tweetId: pick?.x_tweet_id || null,
          pickName: pick?.name || null,
          userId: profile?.id || null,
          wallet: profile?.wallet || null,
        }
        const { data, error: fnError } = await supabase.functions.invoke('claim-attention-eligibility', {
          body: payload,
        })
        if (fnError) throw fnError
        setEligibilityModal({
          pickId: pick?.id,
          pickName: pick?.name || 'Prediction',
          reply: data?.reply ?? null,
          message: data?.message ?? (data?.eligible ? 'You are eligible' : 'Reply not found'),
          eligible: Boolean(data?.eligible),
          choice: data?.choice || null,
          tweetId: data?.tweetId || payload?.tweetId || null,
          tweetHandle: data?.handle || null,
          replied_at: data?.replied_at || null,
          claimTxHash: null,
          claimMessage: null,
        })
      } catch (err) {
        console.error('[ClaimRewards] eligibility check failed', err)
        alert(err?.message || 'Unable to verify eligibility. Please try again.')
      } finally {
        setCheckingPickId(null)
      }
    },
    [authenticated, handleConnectX, login, profile?.id, profile?.wallet, profile?.x_handle],
  )

  const handleClaimShares = useCallback(async () => {
    if (!eligibilityModal?.eligible || !eligibilityModal?.pickId) return
    if (!profile?.id && !profile?.wallet) {
      alert('Connect your profile wallet before claiming.')
      return
    }
    setClaimError(null)
    setClaimingShares(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('claim-reward-shares', {
        body: {
          pickId: eligibilityModal.pickId,
          pickName: eligibilityModal.pickName || null,
          userId: profile?.id || null,
          wallet: profile?.wallet || null,
          choice: eligibilityModal.choice || null,
        },
      })
      if (fnError) throw fnError
      setEligibilityModal((prev) =>
        prev
          ? {
              ...prev,
              claimTxHash: data?.txHash || null,
              claimTransferHash: data?.transferHash || null,
              claimMessage: data?.message || null,
            }
          : prev,
      )
    } catch (err) {
      console.error('[ClaimRewards] claim shares failed', err)
      setClaimError(err?.message || 'Unable to claim shares right now.')
    } finally {
      setClaimingShares(false)
    }
  }, [eligibilityModal, profile?.id, profile?.wallet])

  useEffect(() => {
    const payload = consumeXOauthCallbackPayload()
    if (payload && (payload.code || payload.error)) {
      setPendingXOauth(payload)
    }
  }, [])

  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    const refreshProfile = async () => {
      try {
        await fetchProfile?.()
      } catch (err) {
        console.warn('[ClaimRewards] profile refresh failed', err)
      }
    }
    refreshProfile()
    const handleFocus = () => {
      if (!cancelled) {
        refreshProfile()
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', handleFocus)
    }
  }, [authenticated, fetchProfile])

  useEffect(() => {
    if (!pendingXOauth) return
    if (pendingXOauth.error) {
      setLinkError(pendingXOauth.error_description || pendingXOauth.error || 'Authorization failed.')
      setPendingXOauth(null)
      return
    }
    if (!pendingXOauth.code) {
      setPendingXOauth(null)
      return
    }
    if (!privyUserId) {
      setLinkError('Connect your wallet to finish linking X.')
      return
    }
    let cancelled = false
    setLinkError(null)
    setLinkingX(true)
    ;(async () => {
      try {
        await exchangeCodeForToken({ code: pendingXOauth.code, returnedState: pendingXOauth.state, privyUserId })
        try { await fetchProfile?.() } catch {}
        if (cancelled) return
        setPendingXOauth(null)
        setLinkingX(false)
      } catch (err) {
        if (cancelled) return
        console.error('[ClaimRewards] X exchange failed', err)
        setLinkError(err?.message || 'Unable to link your X account.')
        setLinkingX(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingXOauth, privyUserId, fetchProfile])

  useEffect(() => {
    let isMounted = true
    ;(async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('picks')
          .select(
            'id,name,description,image,status,expires_at,created_at,duration_sec,win_side,result,final_value,yes_label,no_label,yes_value,no_value,resolved_at,x_tweet_id',
          )
          .order('created_at', { ascending: false })
        if (fetchError) throw fetchError
        if (!isMounted) return
        setPicks(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('[ClaimRewards] failed to load picks', err)
        if (isMounted) setError(err)
      } finally {
        if (isMounted) setLoading(false)
      }
    })()
    return () => {
      isMounted = false
    }
  }, [])

  const orderedPicks = useMemo(() => {
    const filtered = showOnlyActive
      ? picks.filter((pick) => {
          const status = typeof pick?.status === 'string' ? pick.status.toLowerCase() : ''
          if (status === 'open' || status === 'active' || status === 'claiming') return true
          const expiresAt = pick?.expires_at ? new Date(pick.expires_at).getTime() : null
          return expiresAt != null ? expiresAt > Date.now() : false
        })
      : picks
    return [...filtered].sort((a, b) => {
      const getTime = (value) => {
        if (!value) return 0
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? 0 : date.getTime()
      }
      const aExpires = getTime(a?.expires_at || a?.resolved_at || a?.created_at)
      const bExpires = getTime(b?.expires_at || b?.resolved_at || b?.created_at)
      return bExpires - aExpires
    })
  }, [picks, showOnlyActive])

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <div className="container mx-auto px-4 py-10 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">Claim free rewards</h1>
          <p className="text-sm text-gray-400">
            Reply “YES” or “NO” under the poll on X, connect your account, and we’ll verify eligibility before crediting your attention rewards.
          </p>
        </header>

        <div className="rounded-2xl border border-cyan-400/40 bg-cyan-500/5 px-5 py-4 text-sm text-cyan-100 space-y-1">
          <p>1. Reply “YES” or “NO” under the X poll for the market you’re claiming.</p>
          <p>2. Connect your wallet &amp; X account.</p>
          <p>3. Click “Claim rewards” so we can verify your reply and credit you.</p>
          {profile?.x_handle && (
            <p className="text-xs font-semibold text-cyan-200 drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]">
              Connected as @{profile.x_handle.replace(/^@/, '')}
            </p>
          )}
          {linkingX && (
            <p className="text-xs text-green-200/80">Finishing your X authorization…</p>
          )}
          <div className="mt-3 flex items-center justify-between text-xs text-cyan-200/80">
            <span className="uppercase tracking-[0.3em]">Only show active picks</span>
            <button
              type="button"
              onClick={() => setShowOnlyActive((prev) => !prev)}
              className={`relative h-5 w-10 rounded-full transition ${
                showOnlyActive ? 'bg-green-bright/80' : 'bg-white/20'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                  showOnlyActive ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-900/20 px-4 py-3 text-sm text-rose-200">
            Failed to load picks — please refresh the page.
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={idx}
                className="h-28 animate-pulse rounded-2xl border border-card-border/60 bg-surface-muted/40"
              />
            ))}
          </div>
        ) : orderedPicks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-card-border/80 px-6 py-20 text-center text-sm text-gray-400">
            No prediction markets available yet.
          </div>
        ) : (
          <div className="space-y-4">
            {orderedPicks.map((pick) => (
              <RewardRow
                key={pick.id}
                pick={pick}
                nowMs={nowMs}
                authenticated={authenticated}
                onConnectX={handleConnectX}
                onCheckEligibility={handleCheckEligibility}
                checkingPickId={checkingPickId}
                connectedHandle={profile?.x_handle || null}
              />
            ))}
          </div>
        )}

        {eligibilityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-cyan-300/40 bg-card-bg px-6 py-5 text-center space-y-4 shadow-[0_40px_140px_rgba(0,0,0,0.85)]">
              <h3 className="text-2xl font-semibold text-white">{eligibilityModal.message}</h3>
              <p className="text-sm text-gray-300">
                {eligibilityModal.pickName ? `Prediction: ${eligibilityModal.pickName}` : null}
              </p>
              {eligibilityModal.reply && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/80">
                  <p className="text-xs uppercase tracking-[0.3em] text-gray-400 mb-1">Latest reply</p>
                  <p>{eligibilityModal.reply}</p>
                </div>
              )}
              {eligibilityModal.eligible && !eligibilityModal.claimTxHash && (
                <div className="space-y-3 text-left text-sm text-cyan-100/80">
                  <p>
                    Tap <span className="font-semibold text-white">Claim shares</span> to mint reward shares to your
                    Privy wallet. Shares remain locked until this prediction settles.
                  </p>
                  <p className="text-xs text-cyan-200/70">
                    Disclaimer: Claims are funded from the Picks prize wallet and cannot be redeemed until the pick is
                    expired and resolved.
                  </p>
                  {claimError && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-900/20 px-4 py-2 text-rose-200 text-xs">
                      {claimError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleClaimShares}
                    disabled={claimingShares}
                    className="w-full rounded-full bg-cyan-400/90 px-5 py-2 text-sm font-semibold text-dark-bg transition hover:bg-cyan-300 disabled:opacity-60"
                  >
                    {claimingShares ? 'Claiming…' : 'Claim shares'}
                  </button>
                </div>
              )}
              {eligibilityModal.claimTxHash && (
                <div className="space-y-3 text-left text-sm text-green-100/80">
                  <p className="font-semibold text-green-200">Shares sent to your Privy wallet.</p>
                  <p className="break-all text-xs text-green-100/70">
                    Purchase tx:{' '}
                    <a
                      href={`https://bscscan.com/tx/${eligibilityModal.claimTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline text-cyan-200 hover:text-white"
                    >
                      {eligibilityModal.claimTxHash}
                    </a>
                  </p>
                  {eligibilityModal.claimTransferHash && (
                    <p className="break-all text-xs text-green-100/70">
                      Transfer tx:{' '}
                      <a
                        href={`https://bscscan.com/tx/${eligibilityModal.claimTransferHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono underline text-cyan-200 hover:text-white"
                      >
                        {eligibilityModal.claimTransferHash}
                      </a>
                    </p>
                  )}
                  {eligibilityModal.claimMessage && (
                    <p className="text-xs text-green-200/70">{eligibilityModal.claimMessage}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const intent = new URL('https://twitter.com/intent/tweet')
                      const title = eligibilityModal.pickName || 'a prediction'
                      const base = `Just claimed free money for predicting "${title}" correctly! You can claim free rewards too at https://picks.run/claimrewards`
                      const txUrl = eligibilityModal.claimTransferHash
                        ? ` https://bscscan.com/tx/${eligibilityModal.claimTransferHash}`
                        : ''
                      intent.searchParams.set('text', `${base}${txUrl}`)
                      window.open(intent.toString(), '_blank', 'noopener,noreferrer')
                    }}
                    className="w-full rounded-full border border-white/50 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10 transition"
                  >
                    Post to X
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setEligibilityModal(null)}
                className="inline-flex items-center justify-center rounded-full border border-cyan-400 px-5 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/10 transition"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RewardRow({ pick, nowMs, authenticated, onConnectX, onCheckEligibility, checkingPickId, connectedHandle }) {
  const timing = computeTiming(pick, nowMs)
  const outcomeCopy = getOutcomeCopy(pick, timing)
  const hasHandleConnection = Boolean(connectedHandle)

  let buttonLabel = 'Connect wallet to claim'
  let buttonHandler = onConnectX
  if (!authenticated) {
    buttonHandler = onConnectX
  } else if (!hasHandleConnection) {
    buttonLabel = 'Connect X to claim'
    buttonHandler = onConnectX
  } else {
    buttonLabel = checkingPickId === pick.id ? 'Checking…' : 'Claim rewards'
    buttonHandler = () => onCheckEligibility(pick)
  }

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-card-border/70 bg-surface-muted/40 p-4 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)] md:flex-row md:items-center">
      <div className="mx-auto h-28 w-28 flex-shrink-0 overflow-hidden rounded-3xl border border-card-border/80 bg-neutral-900 md:mx-0 md:h-24 md:w-24">
        {pick?.image ? (
          <img src={pick.image} alt={pick.name || 'Prediction'} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-black text-xs uppercase tracking-[0.25em] text-gray-500">
            No art
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">{pick?.name || 'Untitled prediction'}</h2>
            {pick?.description && (
              <p className="mt-1 line-clamp-2 text-sm text-gray-300">{pick.description}</p>
            )}
          </div>
          <div className="flex flex-col items-start gap-1">
            {hasHandleConnection && (
              <span className="text-xs uppercase tracking-[0.3em] text-gray-500">Connected as @{connectedHandle.replace(/^@/, '')}</span>
            )}
            <button
              type="button"
              onClick={buttonHandler}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-400/60 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/20 hover:text-white disabled:opacity-60"
              disabled={hasHandleConnection && checkingPickId === pick.id}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-base font-semibold text-white shadow-[0_0_14px_rgba(255,255,255,0.25)]">
                X
              </span>
              <span>{buttonLabel}</span>
            </button>
          </div>
        </div>
        <div className="text-sm">
          {timing.isActive ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-green-bright/10 px-3 py-1 text-green-bright">
              <span className="font-semibold uppercase tracking-[0.25em]">Active</span>
              <span className="text-xs font-medium text-green-100">
                {timing.timeLeftSec != null ? formatCountdown(timing.timeLeftSec) : 'No expiration'}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-neutral-800/70 px-3 py-1 text-gray-200">
              <span className="font-semibold uppercase tracking-[0.25em]">Outcome</span>
              <span className="text-xs font-medium text-gray-200">{outcomeCopy}</span>
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function computeTiming(pick, nowMs) {
  const rawStatus = typeof pick?.status === 'string' ? pick.status.toLowerCase() : ''
  const expiresAt = pick?.expires_at ? new Date(pick.expires_at).getTime() : null
  const timeLeftSec = expiresAt != null ? Math.max(0, Math.floor((expiresAt - nowMs) / 1000)) : null
  const isTimeExpired = expiresAt != null ? nowMs >= expiresAt : false
  const isActiveStatus = rawStatus === 'open' || rawStatus === 'active'
  const isActive = isActiveStatus && (!isTimeExpired || timeLeftSec > 0)
  return { status: rawStatus, expiresAt, timeLeftSec, isActive, isTimeExpired }
}

function getOutcomeCopy(pick, timing) {
  const resolvedSide = normalizeOutcomeValue(pick?.result) || normalizeOutcomeValue(pick?.win_side)
  const finalValue = pick?.final_value
  const yesLabel = pick?.yes_label || pick?.yesValue || null
  const noLabel = pick?.no_label || pick?.noValue || null

  if (resolvedSide === 'void') {
    return finalValue ? `Void · Final: ${finalValue}` : 'Void market'
  }
  if (resolvedSide === 'yes') {
    const label = yesLabel || 'Yes side'
    return finalValue ? `${label} · Final: ${finalValue}` : label
  }
  if (resolvedSide === 'no') {
    const label = noLabel || 'No side'
    return finalValue ? `${label} · Final: ${finalValue}` : label
  }

  if (timing?.status === 'claiming') return 'Claim window open'
  if (timing?.status === 'settled') return 'Settled — rewards distributed'
  if (timing?.status === 'expired' || timing?.isTimeExpired) return 'Expired — awaiting resolution'
  if (timing?.status === 'closed') return 'Closed — pending settlement'
  if (timing?.status === 'failed') return 'Outcome unavailable'

  return 'Awaiting resolution'
}

function formatCountdown(totalSeconds) {
  if (totalSeconds == null) return ''
  if (totalSeconds <= 0) return 'Expired'
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(minutes)}:${pad(seconds)}`
}

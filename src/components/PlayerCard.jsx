import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Interface, parseUnits } from 'ethers'
import { useMetrics } from '../lib/useMetrics'
import { useNow } from '../lib/NowContext'
import { useProfile } from '../lib/useProfile'
import { BSC, MARKET_NATIVE_ABI, getBscScanTx, PRIMARY_BSC_RPC } from '../lib/evm'
import { claimEvmWinnings } from '../lib/claims'
import { supabase } from '../lib/supabase'
import { useWallets, useSendTransaction, toViemAccount } from '@privy-io/react-auth'
import { createWalletClient, http } from 'viem'
import { bsc as VIEM_BSC } from 'viem/chains'
import { formatUsdVolume } from '../lib/volumeFormat'

const SUPABASE_EDGE_URL = 'https://fbwzsmpytdjgbjpwkafy.supabase.co/functions/v1/creator-fee-tracker'
const SUPABASE_TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZid3pzbXB5dGRqZ2JqcHdrYWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5NjUzNjcsImV4cCI6MjA3MjU0MTM2N30.bWgF_d_gqdTW9kGEqUf9B2Ypy8nBPAjZ1ukk8t660Rk'

const normalizeOutcomeValue = (value) => {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (raw === 'less' || raw === 'yes') return 'yes'
  if (raw === 'more' || raw === 'no') return 'no'
  if (raw === 'void') return 'void'
  return null
}

const shortWallet = (value) => {
  if (!value) return '—'
  const clean = value.toLowerCase()
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}

const PlayerCard = ({ player, onSelection, onClick, isActive = false, variant = 'default' }) => {
  const navigate = useNavigate()
  const [selectedOption, setSelectedOption] = useState(null)
  const [amount, setAmount] = useState(0.01)
  const [tradingSide, setTradingSide] = useState(null)
  const [claiming, setClaiming] = useState(false)
  const [claimMessage, setClaimMessage] = useState('')
  const [claimTx, setClaimTx] = useState(null)
  const [claimSucceeded, setClaimSucceeded] = useState(false)
  const { login } = useProfile()
  const { wallets } = useWallets()
  const { sendTransaction } = useSendTransaction()
  const [activeWallet, setActiveWallet] = useState(null)
  const [walletClient, setWalletClient] = useState(null)
  // Quick-buy on card now routes to the detail page where MetaMask trading happens.

  const handleSelection = (option) => {
    const newSelection = selectedOption === option ? null : option
    setSelectedOption(newSelection)
    onSelection({
      ...player,
      selection: newSelection
    })
  }

  // Clicking anywhere on the tile (including buttons) should open the detail panel

  // Truncate text if too long
  const truncateText = (text, maxLength) => {
    if (text && text.length > maxLength) {
      return text.substring(0, maxLength) + '...'
    }
    return text
  }

  const ringClass = selectedOption
    ? 'ring-2 ring-green-bright'
    : isActive
      ? 'ring-2 ring-green-bright'
      : ''

  const borderColorClass = (selectedOption || isActive)
    ? 'border-transparent'
    : 'border-card-border'

  const lessMint = player.lessToken ?? player.lesstoken
  const moreMint = player.moreToken ?? player.moretoken
  const evmMarket = player?.evm_market_address || null
  const marketType = (player?.evm_market_type || '').toLowerCase()
  const isNativeMarket = marketType === 'native_bnb'
  const previewCurrency = player?.preview_currency ?? player?.previewCurrency ?? null
  const displayCurrency = previewCurrency || (evmMarket ? 'BNB' : 'SOL')
  const lessPool = player.lesspool ?? player.lessPool
  const morePool = player.morepool ?? player.morePool
  const creatorWallet = (player?.creator_wallet || player?.creatorWallet || player?.creator?.wallet || '').toLowerCase()
  const creatorAvatar = player?.creator_avatar_url || player?.creatorAvatarUrl || player?.creator?.avatar_url || ''
  const creatorDisplayName = player?.creator_display_name || player?.creatorDisplayName || player?.creator?.display_name || player?.creator?.username || (creatorWallet ? shortWallet(creatorWallet) : 'Unknown creator')
  const creatorInitials = creatorDisplayName?.slice(0, 2)?.toUpperCase() || 'SP'
  const ensureWalletClient = useCallback(async () => {
    if (!activeWallet) return null
    try {
      const account = await toViemAccount({ wallet: activeWallet })
      const transport = http(BSC.rpcUrls?.[0] || PRIMARY_BSC_RPC)
      const wc = createWalletClient({ chain: VIEM_BSC, account, transport })
      setWalletClient(wc)
      return wc
    } catch (_) { return null }
  }, [activeWallet])

  const handleCreatorNav = (event) => {
    event?.stopPropagation?.()
    if (!creatorWallet) return
    navigate(`/profile/${creatorWallet}`)
  }

  const executeTrade = useCallback(async (side) => {
    const amtNum = Number(amount)
    if (!Number.isFinite(amtNum) || amtNum <= 0) throw new Error('Enter a valid amount')
    if (!evmMarket) throw new Error('EVM market not available')
    if (!isNativeMarket) throw new Error('Legacy WBNB markets are disabled. Relaunch this pick.')
    await login()

    // Require Privy embedded EVM wallet
    const embedded = activeWallet
    if (!embedded) throw new Error('Privy wallet not available')

    const amtWei = parseUnits(String(amtNum), 18)
    const I = new Interface(MARKET_NATIVE_ABI)
    const data = side === 'less' ? I.encodeFunctionData('buyYesWithBNB', []) : I.encodeFunctionData('buyNoWithBNB', [])
    const value = `0x${amtWei.toString(16)}`

    // Try Privy send first; fallback to viem wallet client
    const tx = { chainId: 56, to: evmMarket, data, value }
    try {
      const res = await sendTransaction(tx, { address: embedded.address, uiOptions: { showWalletUIs: false } })
      const hash = typeof res === 'string' ? res : res?.hash
      if (!hash) throw new Error('Transaction hash unavailable')
      return hash.toLowerCase()
    } catch (_) {
      const wc = walletClient || (await ensureWalletClient())
      if (!wc) throw new Error('Wallet client unavailable')
      const hash = await wc.sendTransaction({ to: evmMarket, data, value })
      return (hash || '').toLowerCase()
    }
  }, [amount, evmMarket, isNativeMarket, login, activeWallet, sendTransaction, walletClient, ensureWalletClient])

  const trackCreatorFee = useCallback(async (txHash) => {
    if (!txHash || !player?.id || !evmMarket) {
      console.warn('[CreatorFeeTracker] skipped — missing data', { txHash, pickId: player?.id, evmMarket })
      return
    }
    console.log('[CreatorFeeTracker] invoking', { pickId: player.id, txHash, market: evmMarket })
    try {
      const payload = {
        pickId: player.id,
        marketAddress: evmMarket,
        txHash,
      }
      const res = await fetch(SUPABASE_EDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_TEST_TOKEN}`,
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[CreatorFeeTracker] HTTP error', { status: res.status, json })
      } else {
        console.log('[CreatorFeeTracker] success', json)
      }
    } catch (err) {
      console.error('[CreatorFeeTracker] invoke failed', err)
    }
  }, [player?.id, evmMarket])

  const handleClaim = useCallback(async (event) => {
    event?.stopPropagation?.()
    if (!evmMarket) {
      setClaimMessage('EVM market not available for this pick.')
      return
    }
    if (claiming) return
    try {
      setClaiming(true)
      setClaimMessage('Checking wallet…')
      await login()
      const address = activeWallet?.address
      if (!address) throw new Error('Privy wallet required')
      setClaimMessage('Submitting claim…')
      const result = await claimEvmWinnings({ pickId: player.id, marketAddress: evmMarket, wallet: address })
      setClaimSucceeded(true)
      setClaimTx(result?.txHash || result?.txhash || null)
      if (result?.paidOut) {
        const paid = Number(result.paidOut)
        if (Number.isFinite(paid)) {
          setClaimMessage(`Claimed ${paid.toFixed(4)} BNB`)
        } else {
          setClaimMessage('Claim successful')
        }
      } else {
        setClaimMessage('Claim successful')
      }
    } catch (err) {
      console.error('[PlayerCard] claim failed', err)
      setClaimMessage(err?.message || 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }, [claiming, evmMarket, login, player?.id, activeWallet?.address])

  const nowMs = useNow()
  const expiresAt = player?.expires_at ? new Date(player.expires_at).getTime() : null
  const durSec = Number(player?.duration_sec || 0)
  const timeLeftSec = expiresAt ? Math.max(0, Math.floor((expiresAt - nowMs) / 1000)) : null
  const isExpired = timeLeftSec === 0 || (expiresAt && nowMs >= expiresAt)
  const expiredLoggedRef = useRef(false)
  if (isExpired && !expiredLoggedRef.current) {
    // Log once per component instance to avoid console spam
    try { console.log('[countdown] expired pick', player.id, 'expires_at', player.expires_at) } catch {}
    expiredLoggedRef.current = true
  }
  const elapsedSec = expiresAt && durSec > 0 ? Math.min(durSec, Math.max(0, Math.floor((nowMs - (expiresAt - durSec * 1000)) / 1000))) : 0
  const progressPct = durSec > 0 ? Math.min(100, Math.max(0, Math.round((elapsedSec / durSec) * 100))) : 0

  const formatTime = (s) => {
    if (s == null) return ''
    if (s <= 0) return 'Expired'
    if (s >= 86400) {
      const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600)
      return `${d}d ${h}h`
    }
    const hrs = Math.floor(s / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const secs = s % 60
    const pad = (n) => String(n).padStart(2, '0')
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`
  }
  const { data: metrics } = useMetrics({ lessMint, moreMint, lessPool, morePool, createdAt: player.created_at, refreshMs: 20000 })
  const lessCount = useMemo(() => {
    const db = Number(player?.lessholders ?? 0)
    const live = Number(metrics?.less?.holders ?? 0)
    return Number.isFinite(db) && db > 0 ? db : (Number.isFinite(live) ? live : 0)
  }, [metrics, player?.lessholders])
  const moreCount = useMemo(() => {
    const db = Number(player?.moreholders ?? 0)
    const live = Number(metrics?.more?.holders ?? 0)
    return Number.isFinite(db) && db > 0 ? db : (Number.isFinite(live) ? live : 0)
  }, [metrics, player?.moreholders])
  const rawTotal = lessCount + moreCount
  const totalCount = rawTotal
  const lessShare = totalCount > 0 ? (lessCount / totalCount) : 0
  const moreShare = totalCount > 0 ? (moreCount / totalCount) : 0
  const lessPct = totalCount > 0 ? Math.round(lessShare * 100) : 0
  const morePct = totalCount > 0 ? 100 - lessPct : 0
  const lessPctLabel = totalCount > 0 ? `${lessPct}%` : '—'
  const morePctLabel = totalCount > 0 ? `${morePct}%` : '—'
  // Volumes (prefer DB columns). We assume volumes are USD-based from Data API.
  const dbLessVol = Number(player?.lessvolume ?? 0)
  const dbMoreVol = Number(player?.morevolume ?? 0)
  const liveLessVol = Number(metrics?.less?.volume ?? 0)
  const liveMoreVol = Number(metrics?.more?.volume ?? 0)
  const lessVolume = Number.isFinite(dbLessVol) && dbLessVol > 0 ? dbLessVol : (Number.isFinite(liveLessVol) ? liveLessVol : 0)
  const moreVolume = Number.isFinite(dbMoreVol) && dbMoreVol > 0 ? dbMoreVol : (Number.isFinite(liveMoreVol) ? liveMoreVol : 0)
  const estimatedVolume = (Number.isFinite(lessVolume) ? lessVolume : 0) + (Number.isFinite(moreVolume) ? moreVolume : 0)
  const createdAt = player.created_at ? new Date(player.created_at) : null
  const isIndexing = createdAt ? (Date.now() - createdAt.getTime() < 3 * 60 * 1000) : false
  const fmtUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
  const lessFees = (Number.isFinite(lessVolume) && lessVolume > 0) ? fmtUsd(lessVolume * 0.018) : '—'
  const moreFees = (Number.isFinite(moreVolume) && moreVolume > 0) ? fmtUsd(moreVolume * 0.018) : '—'
  const totalFeesUsdNum = Number.isFinite(estimatedVolume) ? estimatedVolume * 0.018 : 0

  // Server status badge (realtime via DB). Fallback to derived, but prefer DB value.
  const rawStatus = (player?.status && typeof player.status === 'string') ? player.status.toLowerCase() : null
  const statusValue = rawStatus || 'open'
  const resultValue = normalizeOutcomeValue(player?.result) || normalizeOutcomeValue(player?.win_side)
  const isClosed = statusValue === 'closed'
  const hasWinner = resultValue === 'yes' || resultValue === 'no'
  const statusLabel = statusValue === 'closed' ? 'Closed' : statusValue === 'open' ? 'Open' : (statusValue.charAt(0).toUpperCase() + statusValue.slice(1))
  const statusClass = statusValue === 'open'
    ? 'bg-green-bright text-dark-bg'
    : 'bg-gray-500 text-white'

  // On-chain gating: read cutoffTime and finalOutcome from the market to decide if buys are allowed
  const [onChainTimeOk, setOnChainTimeOk] = useState(true)
  const [onChainOutcome, setOnChainOutcome] = useState('Pending')
  useEffect(() => {
    let cancelled = false
    if (!evmMarket) { setOnChainTimeOk(true); setOnChainOutcome('Pending'); return }
    const rpcUrl = BSC.rpcUrls?.[0] || PRIMARY_BSC_RPC
    const cutoffSignature = '0x62107e8d'
    const finalOutcomeSignature = '0x404002a6'
    async function rpcFetch(method, params) {
      const body = { jsonrpc: '2.0', id: Math.floor(Math.random()*1e6), method, params }
      const res = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) throw new Error(json.error?.message || 'rpc_error')
      return json.result
    }
    ;(async () => {
      try {
        const [cutRaw, outRaw] = await Promise.all([
          rpcFetch('eth_call', [{ to: evmMarket, data: cutoffSignature }, 'latest']).catch(()=>null),
          rpcFetch('eth_call', [{ to: evmMarket, data: finalOutcomeSignature }, 'latest']).catch(()=>null),
        ])
        if (cancelled) return
        const cutoffSec = cutRaw ? Number(BigInt(cutRaw)) : 0
        const now = Math.floor(Date.now()/1000)
        setOnChainTimeOk(!cutoffSec || now < cutoffSec)
        const outNum = outRaw ? Number(BigInt(outRaw)) : 0
        const outStr = outNum===0?'Pending': outNum===1?'Yes': outNum===2?'No': outNum===3?'Invalid':'Unknown'
        setOnChainOutcome(outStr)
      } catch (_) {
        if (!cancelled) { setOnChainTimeOk(true); setOnChainOutcome('Pending') }
      }
    })()
    return () => { cancelled = true }
  }, [evmMarket])
  const onChainTradingClosed = evmMarket ? (!onChainTimeOk || onChainOutcome !== 'Pending') : false

  // Track Privy embedded EVM wallet
  useEffect(() => {
    const evmWallets = (wallets || []).filter((w) => w?.type === 'ethereum')
    const embedded = evmWallets.find((w) => w?.walletClientType === 'privy') || evmWallets[0] || null
    setActiveWallet(embedded || null)
  }, [wallets])

  const stripTrailingZero = (s) => s.replace(/\.0$/, '')
  const formatVolumeCompact = (n) => {
    const abs = Math.abs(n)
    if (abs >= 1_000_000) {
      const v = n / 1_000_000
      const d = Math.abs(v) < 10 ? 1 : 0
      return stripTrailingZero(v.toFixed(d)) + 'm'
    }
    // Always use thousands for anything below 1m
    const v = n / 1_000
    const d = Math.abs(v) < 10 ? 1 : 0
    return stripTrailingZero(v.toFixed(d)) + 'k'
  }

  const yesLabel = player?.yes_label ?? player?.yesLabel ?? player?.less_label ?? null
  const yesValue = player?.yes_value ?? player?.yesValue ?? null
  const noLabel = player?.no_label ?? player?.noLabel ?? player?.more_label ?? null
  const noValue = player?.no_value ?? player?.noValue ?? null
  const hasOutcomeValue = (val) => val !== null && val !== undefined && String(val).trim() !== ''
  const hasOutcomeRows = hasOutcomeValue(yesLabel) || hasOutcomeValue(yesValue) || hasOutcomeValue(noLabel) || hasOutcomeValue(noValue)
  const descriptionText = player?.description && player.description.trim() ? player.description : null
  const volumeDisplay = useMemo(
    () => formatUsdVolume(player?.trading_volume_wei ?? player?.total_volume_wei),
    [player?.trading_volume_wei, player?.total_volume_wei],
  )
  const showVolume = Boolean(volumeDisplay && volumeDisplay !== '—')

  if (variant === 'home') {
    const homeStatusLabel = isClosed ? 'CLOSED' : 'ACTIVE'
    const rawDescription = (descriptionText || player?.name || '').trim()
    const timeLeftForHome = expiresAt ? Math.max(0, Math.floor((expiresAt - nowMs) / 1000)) : null
    const countdownLabel = !isClosed && timeLeftForHome != null ? formatTime(timeLeftForHome) : null
    const yesProbabilityRaw = Number(player?.yes_probability ?? player?.yesProbability ?? NaN)
    const yesProbability = Number.isFinite(yesProbabilityRaw) ? Math.min(100, Math.max(0, yesProbabilityRaw)) : null
    const yesProbabilityLabel = yesProbability != null ? `${Math.round(yesProbability)}%` : null
    const noProbabilityLabel = yesProbability != null ? `${Math.max(0, 100 - Math.round(yesProbability))}%` : null
    const displayYesLabel = hasOutcomeValue(yesLabel) ? yesLabel : 'Yes outcome'
    const displayNoLabel = hasOutcomeValue(noLabel) ? noLabel : 'No outcome'
    const yesDisplay = yesProbabilityLabel ? `${displayYesLabel} ${yesProbabilityLabel}` : displayYesLabel
    const noDisplay = noProbabilityLabel ? `${displayNoLabel} ${noProbabilityLabel}` : displayNoLabel

    const handleOutcomeClick = (event) => {
      event?.stopPropagation?.()
      if (typeof onClick === 'function') onClick(player)
    }

    return (
      <div
        data-card="true"
        className={`bg-card-bg rounded-3xl overflow-hidden transition-colors duration-200 flex flex-col min-h-[320px] border border-card-border ${ringClass} transform-gpu hover:scale-[1.01] hover:shadow-[0_18px_36px_rgba(0,0,0,0.35)]`}
        onClick={() => onClick(player)}
      >
        <div className="px-5 pt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCreatorNav}
            className={`flex items-center gap-3 rounded-2xl border border-white/10 px-2 py-1.5 text-left transition-colors ${creatorWallet ? 'hover:border-green-bright/60' : 'opacity-60 cursor-default'}`}
          >
            <div className="h-9 w-9 overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-800 to-black">
              {creatorAvatar ? (
                <img src={creatorAvatar} alt={creatorDisplayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white">{creatorInitials}</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.35em] text-gray-500">Created by</div>
              <div className="text-sm font-semibold text-white leading-tight line-clamp-1">{creatorDisplayName}</div>
            </div>
          </button>
          <div className="flex flex-col items-end gap-1">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold tracking-[0.25em] uppercase ${statusClass}`}>
              {homeStatusLabel}
            </span>
            {countdownLabel && (
              <span className="text-xs font-semibold text-white/80">{countdownLabel}</span>
            )}
          </div>
        </div>

        <div className="px-5 mt-4">
          <div className="w-full aspect-[4/3] overflow-hidden rounded-2xl bg-gray-800">
            {player.image ? (
              <img src={player.image} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gray-secondary/20" />
            )}
          </div>
        </div>

        {rawDescription && (
          <div className="px-5 mt-4 text-sm text-gray-100 leading-relaxed line-clamp-3">
            {rawDescription}
          </div>
        )}

        {hasOutcomeRows && (
          <div className="px-5 mt-4 space-y-3 pb-5">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate" title={yesDisplay}>
                  {yesDisplay}
                </div>
              </div>
              <button
                type="button"
                onClick={handleOutcomeClick}
                className={`min-w-[96px] h-10 rounded-xl flex items-center justify-center text-sm font-semibold transition-colors duration-200 ${isClosed ? 'bg-blue-400/40 text-blue-100 cursor-not-allowed' : 'bg-[#2F80FF] text-white hover:bg-[#1f6de6]'}`}
                disabled={isClosed}
              >
                YES
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate" title={noDisplay}>
                  {noDisplay}
                </div>
              </div>
              <button
                type="button"
                onClick={handleOutcomeClick}
                className={`min-w-[96px] h-10 rounded-xl flex items-center justify-center text-sm font-semibold transition-colors duration-200 ${isClosed ? 'bg-pink-400/40 text-pink-100 cursor-not-allowed' : 'bg-[#FF4F8B] text-white hover:bg-[#f53b7b]'}`}
                disabled={isClosed}
              >
                NO
              </button>
            </div>
          </div>
        )}
        {showVolume && (
          <div className="px-5 pb-6">
            <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Volume</div>
            <div className="text-lg font-semibold text-white">{volumeDisplay} Volume</div>
          </div>
        )}

      </div>
    )
  }


  return (
    <div
      data-card="true"
      className={`bg-card-bg rounded-xl overflow-hidden transition-colors duration-200 flex flex-col min-h-[420px] border ${borderColorClass} ${ringClass} transform-gpu hover:scale-[1.01] hover:shadow-[0_18px_36px_rgba(0,0,0,0.35)]`}
    >
      {/* Countdown bar */}
      <div className="relative h-1 bg-card-border">
        <div className={`absolute inset-y-0 left-0 ${isExpired || isClosed ? 'bg-card-border' : 'bg-green-bright'}`} style={{ width: `${progressPct}%` }} />
      </div>
      <div
        className="flex-1 p-4 pb-0 flex flex-col cursor-pointer"
        data-card="true"
        onClick={() => onClick(player)}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex flex-col gap-0.5">
            <div className="w-4 h-0.5 bg-gray-secondary"></div>
            <div className="w-4 h-0.5 bg-gray-secondary"></div>
            <div className="w-4 h-0.5 bg-gray-secondary"></div>
          </div>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
          <div className="text-white font-extrabold text-lg sm:text-xl tracking-tight">
            {formatTime(timeLeftSec)}
          </div>
        </div>
        </div>

        {/* Top image banner */}
        <div className="w-full h-48 md:h-56 overflow-hidden rounded-xl mb-3">
          {player.image ? (
            <img src={player.image} alt={player.name} className="w-full h-full object-cover object-center" />
          ) : (
            <div className="w-full h-full bg-gray-secondary/20" />
          )}
        </div>
        <h3 className="text-white font-medium text-center text-lg truncate max-w-full px-2 mb-2">
          {truncateText(player.name, 30)}
        </h3>

        <div className="bg-stat-bg rounded-lg px-4 py-3 mx-4 mt-2 mb-2">
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-1 truncate">
              {truncateText(player.line, 15)}
            </div>
            <div className="text-lg font-medium text-gray-100 uppercase truncate">
              {truncateText(player.category, 22)}
            </div>
          </div>
        </div>
        {hasOutcomeRows && (
          <div className="px-4 mb-3">
            <div className="rounded-xl border border-card-border/70 bg-surface-muted/30 divide-y divide-card-border/60">
              <div className="grid grid-cols-[minmax(0,1fr)_80px_48px] gap-3 items-center px-3 py-2">
                <div className="text-sm text-gray-100 truncate">{hasOutcomeValue(yesLabel) ? yesLabel : 'Yes outcome'}</div>
                <div className="text-right text-sm font-semibold text-white">{hasOutcomeValue(yesValue) ? yesValue : '—'}</div>
                <span className="text-xs font-semibold uppercase text-green-bright text-right">Yes</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_80px_48px] gap-3 items-center px-3 py-2">
                <div className="text-sm text-gray-100 truncate">{hasOutcomeValue(noLabel) ? noLabel : 'No outcome'}</div>
                <div className="text-right text-sm font-semibold text-white">{hasOutcomeValue(noValue) ? noValue : '—'}</div>
                <span className="text-xs font-semibold uppercase text-rose-400 text-right">No</span>
              </div>
            </div>
          </div>
        )}
        {/* Quick buy + amount input */}
        {!isClosed && (
          <div className="px-4 mb-2">
            <div className="flex flex-wrap gap-2 mb-2">
              {[0.01, 0.02, 0.05, 0.1].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setAmount(v) }}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${amount === v ? 'bg-green-bright text-dark-bg border-transparent' : 'bg-card-bg text-gray-secondary border-card-border hover:border-purple-brand'}`}
                >
                  {v.toFixed(2).replace(/\.00$/,'')} {displayCurrency}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={amount}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)) || 0)}
              className="w-full bg-surface-muted border border-card-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-purple-brand"
              placeholder={`Enter ${displayCurrency} amount`}
            />
          </div>
        )}
        {/* Description above actions */}
        {player.description && (
          <div className="px-4 mb-2 text-sm text-gray-secondary">
            {truncateText(player.description, 140)}
          </div>
        )}
        {showVolume && (
          <div className="px-4 mb-3">
            <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Volume</div>
            <div className="text-lg font-semibold text-white">{volumeDisplay} Volume</div>
          </div>
        )}
        {/* Result notes will be displayed below in the result section when closed */}

      </div>

      {isClosed && hasWinner ? (
        <div className="px-4 mb-3 flex flex-col gap-2">
          <div className="relative overflow-hidden w-full py-3 font-semibold text-lg transition-all border-t border-card-border btn-neon bg-green-bright text-dark-bg text-center">
            <span className="absolute inset-y-0 left-0 bg-green-bright/20 pointer-events-none" style={{ width: '100%' }} aria-hidden />
            FINAL RESULT: {resultValue?.toUpperCase()}
          </div>
          <button
            onClick={handleClaim}
            className={`w-full py-3 rounded-lg font-semibold text-sm border transition-colors ${
              evmMarket
                ? 'bg-dark-bg text-green-bright border-green-bright hover:bg-green-bright/10 disabled:opacity-60'
                : 'bg-card-bg text-gray-secondary border-card-border cursor-not-allowed'
            }`}
            disabled={claiming || claimSucceeded || !evmMarket}
          >
            {!evmMarket
              ? 'Claim unavailable'
              : (claimSucceeded ? 'Claimed' : (claiming ? 'Claiming…' : 'Claim winnings'))}
          </button>
          {claimMessage && (
            <div className="text-xs text-gray-secondary">
              {claimMessage}
              {claimTx ? (
                <>
                  {' '}
                  <a href={getBscScanTx(claimTx)} target="_blank" rel="noreferrer" className="underline">
                    View TX
                  </a>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 mb-3 min-h-[64px] mt-auto">
          <div className="flex gap-2">
          {/* Less button */}
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (tradingSide) return
              const amtNum = Number(amount)
              if (!Number.isFinite(amtNum) || amtNum <= 0) {
                alert('Enter a valid amount first.')
                return
              }
              if (isExpired || isClosed || onChainTradingClosed) {
                alert('Trading is closed for this market.')
                return
              }
              if (!evmMarket) {
                try { if (typeof onClick === 'function') onClick(player) } catch {}
                return
              }
              try {
                setTradingSide('less')
                const txHash = await executeTrade('less')
                if (txHash) trackCreatorFee(txHash)
                alert('Trade submitted. Check MetaMask for confirmation.')
              } catch (err) {
                console.error('[PlayerCard] YES trade failed', err)
                alert(err?.message || 'EVM trade failed')
              } finally {
                setTradingSide(null)
              }
            }}
            className={`relative overflow-hidden flex-1 py-3 font-semibold text-lg transition-all border border-card-border rounded-md btn-neon ${
              tradingSide === 'less' || selectedOption === 'less' ? 'bg-green-bright text-dark-bg' : 'bg-green-bright/10 text-green-bright'
            }`}
            disabled={isExpired || onChainTradingClosed || !!tradingSide}
          >
            <span
              className="absolute inset-y-0 left-0 bg-green-bright/20 pointer-events-none"
              style={{ width: `${lessPct}%` }}
              aria-hidden
            />
            Yes
          </button>
          {/* More button */}
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (tradingSide) return
              const amtNum = Number(amount)
              if (!Number.isFinite(amtNum) || amtNum <= 0) {
                alert('Enter a valid amount first.')
                return
              }
              if (isExpired || isClosed || onChainTradingClosed) {
                alert('Trading is closed for this market.')
                return
              }
              if (!evmMarket) {
                try { if (typeof onClick === 'function') onClick(player) } catch {}
                return
              }
              try {
                setTradingSide('more')
                const txHash = await executeTrade('more')
                if (txHash) trackCreatorFee(txHash)
                alert('Trade submitted. Check MetaMask for confirmation.')
              } catch (err) {
                console.error('[PlayerCard] NO trade failed', err)
                alert(err?.message || 'EVM trade failed')
              } finally {
                setTradingSide(null)
              }
            }}
            className={`relative overflow-hidden flex-1 py-3 font-semibold text-lg transition-all border border-card-border rounded-md btn-neon ${
              tradingSide === 'more' || selectedOption === 'more' ? 'bg-green-bright text-dark-bg' : 'bg-green-bright/10 text-green-bright'
            }`}
            disabled={isExpired || onChainTradingClosed || !!tradingSide}
          >
            <span
              className="absolute inset-y-0 left-0 bg-purple-brand/20 pointer-events-none"
              style={{ width: `${morePct}%` }}
              aria-hidden
            />
            No
          </button>
          </div>
        </div>
      )}

      {/* Moderator notes hidden on card (available in detail view) */}

      {/* Volume & metrics hidden on card (available in detail view) */}
    </div>
  )
}

export default PlayerCard

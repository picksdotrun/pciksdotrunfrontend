import { useState, useEffect } from 'react'
import { useProfile } from '../lib/useProfile'
import { useUserWallet } from '../lib/useUserWallet'
import { supabase } from '../lib/supabase'
import { apiUrl } from '../lib/api.js'
import { launchOverUnderTokens } from '../lib/launchTokens'
import { claimEvmWinnings } from '../lib/claims'
import { getBscScanTx } from '../lib/evm'
import { useWallets } from '@privy-io/react-auth'
import { useNow } from '../lib/NowContext'

const normalizeOutcomeValue = (value) => {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (raw === 'less' || raw === 'yes') return 'yes'
  if (raw === 'more' || raw === 'no') return 'no'
  if (raw === 'void') return 'void'
  return null
}

const DetailPanel = ({ isOpen, player, onClose, onTokensLaunched }) => {
  if (!player) return null
  const [launching, setLaunching] = useState(false)
  const [swapping, setSwapping] = useState(null) // 'less' | 'more' | null
  const [amountSol, setAmountSol] = useState(0.1)
  const [swapSuccess, setSwapSuccess] = useState(null) // { side, signature }
  const [claiming, setClaiming] = useState(false)
  const [claimMessage, setClaimMessage] = useState('')
  const [claimTx, setClaimTx] = useState(null)
  const [claimSucceeded, setClaimSucceeded] = useState(false)
  const { authenticated, login } = useProfile()
  const { wallets } = useWallets()
  const [evmAddress, setEvmAddress] = useState(null)
  const { publicKey: userWallet } = useUserWallet()
  const [trades, setTrades] = useState([])
  const [chainTrades, setChainTrades] = useState([])
  // Show only token mint (CA) in the UI; never show pool
  const lessMintCA = (player.lessToken ?? player.lesstoken) || null
  const moreMintCA = (player.moreToken ?? player.moretoken) || null
  // Keep pools internal for launching/trading links only
  const lessPool = player.lesspool ?? player.lessPool
  const morePool = player.morepool ?? player.morePool
  const evmMarket = player?.evm_market_address || null
  const evmChain = player?.evm_chain || 'bsc-mainnet'
  const lessVolDb = Number(player?.lessvolume ?? 0)
  const moreVolDb = Number(player?.morevolume ?? 0)
  const fmtUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
  const lessFeesUsd = (Number.isFinite(lessVolDb) && lessVolDb > 0) ? fmtUsd(lessVolDb * 0.018) : '—'
  const moreFeesUsd = (Number.isFinite(moreVolDb) && moreVolDb > 0) ? fmtUsd(moreVolDb * 0.018) : '—'
  const nowMs = useNow()
  const expiresAt = player?.expires_at ? new Date(player.expires_at).getTime() : null
  const timeLeftSec = expiresAt ? Math.max(0, Math.floor((expiresAt - nowMs) / 1000)) : null
  const isExpired = timeLeftSec === 0 || (expiresAt && nowMs >= expiresAt)
  // Server-driven status/result for post-closure rendering
  const rawStatus = (player?.status && typeof player.status === 'string') ? player.status.toLowerCase() : null
  const statusValue = rawStatus || (isExpired ? 'closed' : 'open')
  const primaryResult = normalizeOutcomeValue(player?.result)
  const fallbackResult = normalizeOutcomeValue(player?.win_side)
  const resultValue = primaryResult || fallbackResult
  const isClosed = statusValue === 'closed'
  const hasWinner = resultValue === 'yes' || resultValue === 'no'
  const toYesNo = (val) => (val === 'yes' ? 'YES' : val === 'no' ? 'NO' : (val || '').toUpperCase())
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
  const shortWallet = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')
  const formatBnb = (weiValue) => {
    try {
      const big = BigInt(weiValue || 0)
      const base = 10n ** 18n
      const whole = big / base
      const remainder = big % base
      const dec = Number(remainder) / 1e18
      const total = Number(whole) + dec
      return total.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
    } catch (_) {
      const fallback = Number(weiValue) / 1e18
      return Number.isFinite(fallback)
        ? fallback.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
        : '0.0000'
    }
  }

  const handleClaim = async () => {
    if (!evmMarket) {
      setClaimMessage('EVM market not available for this pick.')
      return
    }
    if (claiming || claimSucceeded) return
    try {
      setClaiming(true)
      setClaimTx(null)
      setClaimMessage('Checking wallet…')
      await login()
      const address = evmAddress
      if (!address) throw new Error('Privy wallet required')
      setClaimMessage('Submitting claim…')
      const result = await claimEvmWinnings({ pickId: player.id, marketAddress: evmMarket, wallet: address })
      setClaimSucceeded(true)
      setClaimTx(result?.txHash || result?.txhash || null)
      if (result?.paidOut) {
        const paid = Number(result.paidOut)
        setClaimMessage(Number.isFinite(paid) ? `Claimed ${paid.toFixed(4)} BNB` : 'Claim successful')
      } else {
        setClaimMessage('Claim successful')
      }
    } catch (err) {
      console.error('[DetailPanel] claim failed', err)
      setClaimMessage(err?.message || 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }

  const ensureTokensLaunched = async () => {
    if (lessMintCA && moreMintCA) return { lessMint: lessMintCA, moreMint: moreMintCA, lessPool, morePool }
    setLaunching(true)
    try {
      const result = await launchOverUnderTokens({
        pickId: player.id,
        name: player.name,
        line: player.line,
        category: player.category,
        description: player.description,
        image: player.image,
      })
      // Notify parent to update state so UI re-renders with both links
      if (onTokensLaunched) {
        onTokensLaunched(player.id, result.lessMint, result.moreMint)
      }
      return result
    } finally {
      setLaunching(false)
    }
  }

  // Load trades for this pick (holders list)
  useEffect(() => {
    let mounted = true
    if (!player?.id) return
    ;(async () => {
      const { data } = await supabase
        .from('user_trades')
        .select('user_wallet, side, amount_sol, created_at')
        .eq('pick_id', player.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (mounted) setTrades(Array.isArray(data) ? data : [])
    })()
    const channel = supabase
      .channel(`trades-${player.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_trades', filter: `pick_id=eq.${player.id}` }, (payload) => {
        const row = payload.new
        if (row && mounted) setTrades(prev => [row, ...prev])
      })
      .subscribe()
    return () => { mounted = false; try { supabase.removeChannel(channel) } catch {} }
  }, [player?.id])

  useEffect(() => {
    let active = true
    if (!player?.id) return
    ;(async () => {
      const { data } = await supabase
        .from('trades')
        .select('*')
        .eq('pick_id', player.id)
        .order('block_number', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)
      if (active) setChainTrades(Array.isArray(data) ? data : [])
    })()
    const channel = supabase
      .channel(`evm-trades-${player.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `pick_id=eq.${player.id}` }, (payload) => {
        const row = payload.new
        if (!row) return
        setChainTrades((prev) => {
          const next = [row, ...prev]
          return next.slice(0, 50)
        })
      })
      .subscribe()
    return () => {
      active = false
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [player?.id])

  // Track Privy embedded EVM wallet address
  useEffect(() => {
    const evm = (wallets || []).find((w) => w?.type === 'ethereum')
    setEvmAddress(evm?.address || null)
  }, [wallets])

  return (
    <>
      {/* Backdrop: mobile only so desktop can interact with cards while open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity duration-300 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sliding Panel */}
      <div 
        data-detail-panel="true"
        onClick={(e) => { e.stopPropagation() }}
        className={`fixed top-0 right-0 h-full w-full md:w-[425px] bg-card-bg border-l border-card-border z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-6">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-secondary hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Large Image */}
          <div className="flex justify-center mb-6">
            <div className="w-48 h-48 rounded-full overflow-hidden bg-gradient-to-b from-card-border to-card-bg">
              {player.image ? (
                <img 
                  src={player.image} 
                  alt={player.name}
                  className="w-full h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-full h-full bg-gray-secondary/20"></div>
                </div>
              )}
            </div>
          </div>

          {/* Name and Stat Summary */}
          <h2 className="text-3xl font-bold text-white text-center mb-1">{player.name}</h2>
          {expiresAt && (
            <div className="text-center text-xs text-gray-secondary mb-2">{formatTime(timeLeftSec)}</div>
          )}
          <div className="bg-stat-bg rounded-lg px-4 py-3 mb-6">
            <div className="text-center">
              <div className="text-5xl font-bold text-white mb-1">{player.line}</div>
              <div className="text-xl font-medium text-gray-100 uppercase">{player.category}</div>
            </div>
          </div>
          {player.description && (
            <div className="bg-card-bg border border-card-border rounded-lg p-4 mb-8">
              <h3 className="text-white font-semibold mb-2">Description</h3>
              <p className="text-gray-secondary leading-relaxed">{player.description}</p>
            </div>
          )}
          {/* Result notes are shown below the result banner when closed */}

          {/* Token Addresses */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-card-bg rounded-lg p-4">
              <h3 className="text-sm text-gray-secondary mb-2">Yes Token</h3>
              {(lessMintCA) ? (
                <a
                  href={`https://solscan.io/token/${lessMintCA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-brand hover:text-purple-brand/80 break-all font-mono"
                >
                  {lessMintCA}
                </a>
              ) : (
                <div className="text-xs text-gray-secondary break-all font-mono">
                  Token will be launched when bet is placed
                </div>
              )}
            </div>
            <div className="bg-card-bg rounded-lg p-4">
              <h3 className="text-sm text-gray-secondary mb-2">No Token</h3>
              {(moreMintCA) ? (
                <a
                  href={`https://solscan.io/token/${moreMintCA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-brand hover:text-purple-brand/80 break-all font-mono"
                >
                  {moreMintCA}
                </a>
              ) : (
                <div className="text-xs text-gray-secondary break-all font-mono">
                  Token will be launched when bet is placed
                </div>
              )}
            </div>
          </div>

          {/* Fees (1.8%) */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-card-bg rounded-lg p-4">
              <h3 className="text-sm text-gray-secondary mb-2">Yes Fees (1.8%)</h3>
              <div className="text-white font-mono text-sm">{lessFeesUsd}</div>
            </div>
            <div className="bg-card-bg rounded-lg p-4">
              <h3 className="text-sm text-gray-secondary mb-2">No Fees (1.8%)</h3>
              <div className="text-white font-mono text-sm">{moreFeesUsd}</div>
            </div>
          </div>

          {/* Result banner or Quick Buy + Big Buttons */}
          {isClosed && hasWinner ? (
            <div className="mb-4 space-y-3">
              <div className="relative overflow-hidden w-full py-3 font-semibold text-lg transition-all border-t border-card-border btn-neon bg-green-bright text-dark-bg text-center">
                <span className="absolute inset-y-0 left-0 bg-green-bright/20 pointer-events-none" style={{ width: '100%' }} aria-hidden />
                FINAL RESULT: {toYesNo(resultValue)}
              </div>
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming || claimSucceeded || !evmMarket}
                className={`w-full py-3 rounded-lg font-semibold text-sm border transition-colors ${
                  evmMarket
                    ? 'bg-dark-bg text-green-bright border-green-bright hover:bg-green-bright/10 disabled:opacity-60'
                    : 'bg-card-bg text-gray-secondary border-card-border cursor-not-allowed'
                }`}
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
          <>
          <div className="mb-3">
            <div className="flex flex-wrap gap-2 mb-2">
              {[0.1, 0.2, 1, 5].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmountSol(v)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${amountSol === v ? 'bg-green-bright text-dark-bg border-transparent' : 'bg-card-bg text-gray-secondary border-card-border hover:border-purple-brand'}`}
                >
                  {v.toFixed(2).replace(/\.00$/,'')} SOL
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={amountSol}
              onChange={(e) => setAmountSol(Math.max(0, Number(e.target.value)) || 0)}
              className="w-full bg-surface-muted border border-card-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-purple-brand"
              placeholder="Enter SOL amount"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-8">
            {swapping === 'less' ? (
              <div className="bg-green-bright text-dark-bg py-6 rounded-xl font-bold text-2xl text-center btn-neon">
              <div className="mb-3">Swapping…</div>
                <div className="w-full h-2 rounded bg-dark-bg/30 overflow-hidden">
                  <div className="h-full bg-dark-bg/60 progress-bar" />
                </div>
              </div>
            ) : (
              <button
                disabled={launching || swapping !== null || isExpired || isClosed}
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    setSwapping('less')
                    const res = await ensureTokensLaunched()
                    const { swapSolToMint } = await import('../lib/swap')
                    const toMint = (lessMintCA || res.lessMint)
                    if (!toMint) return
                    const amt = Number(amountSol) || 0.01
                    const sig = await swapSolToMint({ toMint, amountSol: amt, slippage: 10 })
                    setSwapSuccess({ side: 'less', signature: sig })
                    // Log trade
                    try {
                      const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
                      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
                      if (base && anon) {
                        await fetch(`${base}/functions/v1/log-trade`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anon}`, 'apikey': anon },
                          body: JSON.stringify({ pickId: player.id, userWallet: (userWallet || ''), side: 'less', amountSol: amt }),
                        })
                      }
                    } catch (_) {}
                    // best-effort: record user's prediction if authenticated
                    try {
                      const token = await getAccessToken().catch(() => null)
                      const headers = { 'Content-Type': 'application/json' }
                      if (token) headers['Authorization'] = `Bearer ${token}`
                      await fetch(apiUrl('/record-prediction'), {
                        method: 'POST', headers,
                        body: JSON.stringify({ pickId: player.id, side: 'less', amountSol: amt, txSignature: sig }),
                      })
                    } catch (_) {}
                  } catch (e) {
                    console.error('LESS swap failed:', e)
                    alert(e?.message || 'Swap failed. Market may not be supported yet.')
                  } finally {
                    setSwapping(null)
                  }
                }}
                className={`bg-green-bright text-dark-bg py-6 rounded-xl font-bold text-2xl text-center btn-neon ${launching || isExpired ? 'opacity-70 cursor-not-allowed' : 'hover:opacity-90'}`}
              >
                {isExpired ? 'Expired' : (launching ? 'Launching…' : 'Yes')}
              </button>
            )}

            {swapping === 'more' ? (
              <div className="bg-green-bright text-dark-bg py-6 rounded-xl font-bold text-2xl text-center btn-neon">
                <div className="mb-3">Swapping…</div>
                <div className="w-full h-2 rounded bg-dark-bg/30 overflow-hidden">
                  <div className="h-full bg-dark-bg/60 progress-bar" />
                </div>
              </div>
            ) : (
              <button
                disabled={launching || swapping !== null || isExpired || isClosed}
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    setSwapping('more')
                    const res = await ensureTokensLaunched()
                    const { swapSolToMint } = await import('../lib/swap')
                    const toMint = (moreMintCA || res.moreMint)
                    if (!toMint) return
                    const amt = Number(amountSol) || 0.01
                    const sig = await swapSolToMint({ toMint, amountSol: amt, slippage: 10 })
                    setSwapSuccess({ side: 'more', signature: sig })
                    try {
                      const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
                      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
                      if (base && anon) {
                        await fetch(`${base}/functions/v1/log-trade`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anon}`, 'apikey': anon },
                          body: JSON.stringify({ pickId: player.id, userWallet: (userWallet || ''), side: 'more', amountSol: amt }),
                        })
                      }
                    } catch (_) {}
                    try {
                      const token = await getAccessToken().catch(() => null)
                      const headers = { 'Content-Type': 'application/json' }
                      if (token) headers['Authorization'] = `Bearer ${token}`
                      await fetch(apiUrl('/record-prediction'), {
                        method: 'POST', headers,
                        body: JSON.stringify({ pickId: player.id, side: 'more', amountSol: amt, txSignature: sig }),
                      })
                    } catch (_) {}
                  } catch (e) {
                    console.error('MORE swap failed:', e)
                    alert(e?.message || 'Swap failed. Market may not be supported yet.')
                  } finally {
                    setSwapping(null)
                  }
                }}
                className={`bg-green-bright text-dark-bg py-6 rounded-xl font-bold text-2xl text-center btn-neon ${launching || isExpired ? 'opacity-70 cursor-not-allowed' : 'hover:opacity-90'}`}
              >
                {isExpired ? 'Expired' : (launching ? 'Launching…' : 'No')}
              </button>
            )}
          </div>
          </>
          )}

          {/* Holders + Moderator notes */}
          <div className="mt-3 bg-card-bg border border-card-border rounded-lg p-4 mb-4">
            <h3 className="text-gray-200 font-semibold text-xs uppercase tracking-wide mb-2">HOLDERS {trades && trades.length ? `(${new Set(trades.map(t=>t.user_wallet)).size})` : ''}</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {trades && trades.length > 0 ? trades.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="text-gray-100">{t.user_wallet?.slice(0,6)}…{t.user_wallet?.slice(-4)} · {String(t.side || '').toUpperCase()}</div>
                  <div className="text-gray-secondary">{new Date(t.created_at).toLocaleString()}</div>
                </div>
              )) : (
                <div className="text-gray-secondary text-sm">No holders yet</div>
              )}
            </div>
          </div>
          {chainTrades.length > 0 && (
            <div className="mt-3 bg-card-bg border border-card-border rounded-lg p-4 mb-4">
              <h3 className="text-gray-200 font-semibold text-xs uppercase tracking-wide mb-2">Live EVM Trades</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {chainTrades.map((trade) => (
                  <div key={`${trade.tx_hash}-${trade.log_index}`} className="flex items-center justify-between text-xs border border-card-border/40 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-gray-100 font-semibold">{shortWallet(trade.trader)} · {trade.is_yes ? 'YES' : 'NO'}</div>
                      <div className="text-gray-secondary text-[11px]">{trade.occurred_at ? new Date(trade.occurred_at).toLocaleString() : `Block ${trade.block_number || '—'}`}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-bold">{formatBnb(trade.amount_wei)} BNB</div>
                      <a href={getBscScanTx(trade.tx_hash)} target="_blank" rel="noreferrer" className="text-xs text-purple-brand hover:text-purple-brand/80">View tx</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Always-visible moderator notes for consistent layout */}
          <div className="mt-3 bg-card-bg border border-card-border rounded-lg p-4 mb-8">
            <h3 className="text-gray-200 font-semibold text-xs uppercase tracking-wide mb-2">Moderator Result Notes</h3>
            <p className="text-green-bright leading-relaxed whitespace-pre-wrap">
              {isClosed && player.moderation_description
                ? player.moderation_description
                : 'Pick is still active. Notes will appear here by our moderation team upon expiration'}
            </p>
          </div>

          {swapSuccess && (
            <div className="bg-card-bg border border-green-bright/40 rounded-lg p-4 mb-6">
              <div className="text-green-bright font-extrabold text-lg mb-1">Swap Submitted!</div>
              <div className="text-gray-secondary text-sm mb-2">Your {(swapSuccess.side==='less'?'YES':swapSuccess.side==='more'?'NO':swapSuccess.side).toUpperCase()} trade was sent.</div>
              <a
                href={`https://solscan.io/tx/${swapSuccess.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-purple-brand hover:text-purple-brand/80 text-sm"
              >
                View on Solscan
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                  <path d="M12.293 2.293a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L14 5.414V13a1 1 0 11-2 0V5.414L9.707 7.707A1 1 0 018.293 6.293l4-4z"/>
                  <path d="M3 9a1 1 0 011-1h3a1 1 0 110 2H5v6h10v-2a1 1 0 112 0v3a1 1 0 01-1 1H4a1 1 0 01-1-1V9z"/>
                </svg>
              </a>
            </div>
          )}

          {/* Explainer Text */}
          <div className="bg-card-bg rounded-lg p-4 text-sm text-gray-secondary leading-relaxed">
            <h3 className="text-white font-semibold mb-2">How It Works</h3>
            <p className="mb-3">
              Each pick launches a BNB smart contract with two vaults—one for <strong>Yes</strong> shares and one for <strong>No</strong> shares. When you enter an amount, the contract mints shares from the selected vault in exchange for your BNB.
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>Your shares track your position: Yes shares if you back the line, No shares if you fade it.</li>
              <li>Vault balances update in real time, letting you rebalance or exit before settlement.</li>
              <li>Once the pick is concluded, the winning vault unlocks and holders can redeem their shares directly back into BNB.</li>
              <li>The opposing vault is settled to zero, so only the correct side can withdraw.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

export default DetailPanel

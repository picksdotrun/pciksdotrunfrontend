import { useEffect, useMemo, useState, useCallback } from 'react'
import { getBscScanTx, formatUnits, parseUnits, BSC, MARKET_NATIVE_ABI, PRIMARY_BSC_RPC } from '../lib/evm'
import { useProfile } from '../lib/useProfile'
import { triggerCreatorFeeTracker } from '../lib/creatorFeeTracker'
import { useWallets, toViemAccount } from '@privy-io/react-auth'
import { Interface } from 'ethers'
import { createWalletClient, http } from 'viem'
import { bsc as VIEM_BSC } from 'viem/chains'

export default function EvmTradePanel({ pick, onMarketStats, onWalletSnapshot }) {
  const marketAddr = pick?.evm_market_address
  const marketType = (pick?.evm_market_type || '').toLowerCase()
  const isNativeMarket = marketType === 'native_bnb'
  const cutoff = pick?.evm_cutoff_time ? new Date(pick.evm_cutoff_time).getTime() : null

  const { login } = useProfile()
  const { wallets } = useWallets()
  const [activeWallet, setActiveWallet] = useState(null)
  const address = activeWallet?.address || null
  const [walletClient, setWalletClient] = useState(null)
  const [decimals, setDecimals] = useState(18)
  const [bnbBal, setBnbBal] = useState('0')
  const [yesShareBal, setYesShareBal] = useState('0')
  const [noShareBal, setNoShareBal] = useState('0')
  const [yesShareRaw, setYesShareRaw] = useState(0n)
  const [noShareRaw, setNoShareRaw] = useState(0n)
  const [shareAddrs, setShareAddrs] = useState({
    yes: typeof pick?.evm_yes_token_address === 'string' && pick.evm_yes_token_address.startsWith('0x')
      ? pick.evm_yes_token_address.toLowerCase()
      : null,
    no: typeof pick?.evm_no_token_address === 'string' && pick.evm_no_token_address.startsWith('0x')
      ? pick.evm_no_token_address.toLowerCase()
      : null,
  })
  const [amount, setAmount] = useState('0.01')
  const [busy, setBusy] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [status, setStatus] = useState('')
  const [tx, setTx] = useState(null)
  const marketInterface = useMemo(() => new Interface(MARKET_NATIVE_ABI), [])
  const [finalOutcomeValue, setFinalOutcomeValue] = useState(0)
  const [totals, setTotals] = useState({ vaultYes: 0n, vaultNo: 0n, sYes: 0n, sNo: 0n })
  const [pressedButton, setPressedButton] = useState(null)
  const [burst, setBurst] = useState(null)
  const [tradeSuccess, setTradeSuccess] = useState(null)
  const [tradeSuccessDone, setTradeSuccessDone] = useState(false)
  const [claimBurst, setClaimBurst] = useState(false)
  const [claimSuccess, setClaimSuccess] = useState(null)

  const outcomeLabel = useMemo(() => {
    switch (finalOutcomeValue) {
      case 1: return 'Yes'
      case 2: return 'No'
      case 3: return 'Invalid'
      default: return 'Pending'
    }
  }, [finalOutcomeValue])

  const tradingClosed = cutoff && Date.now() >= cutoff
  const buyDisabled = useMemo(() => busy || tradingClosed || outcomeLabel !== 'Pending', [busy, tradingClosed, outcomeLabel])

  const rpcFetch = useCallback(async (method, params = []) => {
    const url = (BSC.rpcUrls && BSC.rpcUrls[0]) || PRIMARY_BSC_RPC
    const body = { jsonrpc: '2.0', id: Math.floor(Math.random()*1e6), method, params }
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) throw new Error(json.error?.message || 'rpc_error')
    return json.result
  }, [])

  const encodeBalanceOf = useCallback((holder) => {
    if (!holder) return null
    const cleanHolder = holder.toLowerCase().replace(/^0x/, '').padStart(64, '0')
    return `0x70a08231${cleanHolder}`
  }, [])

  async function refreshBalances(addr = address) {
    if (!addr) return
    try {
      const bnb = await rpcFetch('eth_getBalance', [addr, 'latest']).then((x)=> BigInt(x))
      setBnbBal(formatUnits(bnb, 18))
      setDecimals(18)
      const balanceData = encodeBalanceOf(addr)
      if (balanceData && (shareAddrs.yes || shareAddrs.no)) {
        if (shareAddrs.yes) {
          const raw = await rpcFetch('eth_call', [{ to: shareAddrs.yes, data: balanceData }, 'latest']).catch(() => '0x0')
          const rawBig = raw ? BigInt(raw) : 0n
          setYesShareRaw(rawBig)
          setYesShareBal(formatUnits(rawBig, 18))
        } else {
          setYesShareRaw(0n)
          setYesShareBal('0')
        }
        if (shareAddrs.no) {
          const raw = await rpcFetch('eth_call', [{ to: shareAddrs.no, data: balanceData }, 'latest']).catch(() => '0x0')
          const rawBig = raw ? BigInt(raw) : 0n
          setNoShareRaw(rawBig)
          setNoShareBal(formatUnits(rawBig, 18))
        } else {
          setNoShareRaw(0n)
          setNoShareBal('0')
        }
      } else {
        setYesShareRaw(0n)
        setNoShareRaw(0n)
        setYesShareBal('0')
        setNoShareBal('0')
      }
    } catch (_) {}
  }

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

  useEffect(() => {
    const nextYes = typeof pick?.evm_yes_token_address === 'string' && pick.evm_yes_token_address.startsWith('0x')
      ? pick.evm_yes_token_address.toLowerCase()
      : null
    const nextNo = typeof pick?.evm_no_token_address === 'string' && pick.evm_no_token_address.startsWith('0x')
      ? pick.evm_no_token_address.toLowerCase()
      : null
    if (nextYes || nextNo) {
      setShareAddrs((prev) => ({
        yes: nextYes || prev.yes || null,
        no: nextNo || prev.no || null,
      }))
    }
  }, [pick?.evm_yes_token_address, pick?.evm_no_token_address])

  useEffect(() => {
    let cancelled = false
    if (!marketAddr || (shareAddrs.yes && shareAddrs.no)) return
    const fetchShareAddresses = async () => {
      try {
        const yesData = marketInterface.encodeFunctionData('yesShare', [])
        const noData = marketInterface.encodeFunctionData('noShare', [])
        const [rawYes, rawNo] = await Promise.all([
          rpcFetch('eth_call', [{ to: marketAddr, data: yesData }, 'latest']),
          rpcFetch('eth_call', [{ to: marketAddr, data: noData }, 'latest']),
        ])
        if (cancelled) return
        const decodedYes = marketInterface.decodeFunctionResult('yesShare', rawYes)?.[0]
        const decodedNo = marketInterface.decodeFunctionResult('noShare', rawNo)?.[0]
        setShareAddrs({
          yes: decodedYes ? decodedYes.toLowerCase() : null,
          no: decodedNo ? decodedNo.toLowerCase() : null,
        })
      } catch (err) {
        if (!cancelled) {
          console.error('[EvmTradePanel] Failed to load share addresses', err)
        }
      }
    }
    fetchShareAddresses()
    return () => { cancelled = true }
  }, [marketAddr, marketInterface, rpcFetch, shareAddrs.yes, shareAddrs.no])

  const fetchMarketState = useCallback( async () => {
    if (!marketAddr) return
    try {
      const finalData = marketInterface.encodeFunctionData('finalOutcome', [])
      const totalsData = marketInterface.encodeFunctionData('getTotals', [])
      const [rawFinal, rawTotals] = await Promise.all([
        rpcFetch('eth_call', [{ to: marketAddr, data: finalData }, 'latest']),
        rpcFetch('eth_call', [{ to: marketAddr, data: totalsData }, 'latest']).catch(() => null),
      ])
      if (rawFinal) {
        const decoded = marketInterface.decodeFunctionResult('finalOutcome', rawFinal)?.[0]
        setFinalOutcomeValue(Number(decoded || 0))
      }
      if (rawTotals) {
        const decodedTotals = marketInterface.decodeFunctionResult('getTotals', rawTotals)
        const vaultYes = BigInt(decodedTotals?.[0] || 0)
        const vaultNo = BigInt(decodedTotals?.[1] || 0)
        const sYes = BigInt(decodedTotals?.[2] || 0)
        const sNo = BigInt(decodedTotals?.[3] || 0)
        const nextTotals = { vaultYes, vaultNo, sYes, sNo }
        setTotals(nextTotals)
        if (typeof onMarketStats === 'function') {
          onMarketStats(nextTotals)
        }
      }
    } catch (err) {
      console.error('[EvmTradePanel] Failed to fetch market state', err)
    }
  }, [marketAddr, marketInterface, onMarketStats, rpcFetch])

  useEffect(() => {
    fetchMarketState()
  }, [fetchMarketState])

  useEffect(() => {
    if (!tradeSuccess) return
    setTradeSuccessDone(false)
    const timer = setTimeout(() => setTradeSuccessDone(true), 1200)
    return () => clearTimeout(timer)
  }, [tradeSuccess])

  useEffect(() => {
    return () => {
      if (typeof onMarketStats === 'function') {
        onMarketStats(null)
      }
    }
  }, [onMarketStats])

  const hexToBigInt = (hex) => {
    if (typeof hex !== 'string') throw new Error('invalid_hex')
    return BigInt(hex)
  }
  const hexToNumber = (hex) => Number(hexToBigInt(hex))

  const triggerButtonEffect = (side) => {
    setPressedButton(side)
    setBurst({ side, ts: Date.now() })
    setTimeout(() => {
      setPressedButton((current) => (current === side ? null : current))
    }, 180)
    setTimeout(() => {
      setBurst((current) => (current?.side === side ? null : current))
    }, 420)
  }

  async function onBuy(side) {
    try {
      setBusy(true); setStatus(`Buying ${side.toUpperCase()}…`); setTx(null)
      if (!isNativeMarket) throw new Error('Legacy WBNB markets are disabled. Relaunch this pick through the admin panel.')
      if (!address) {
        await login()
        throw new Error('Privy wallet required')
      }
      if (!marketAddr) throw new Error('Market unavailable')
      const normalizedAmount = (amount || '').trim() || '0'
      const amountNumber = Number.parseFloat(normalizedAmount)
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) throw new Error('Enter a valid amount')
      const amt = parseUnits(normalizedAmount, decimals)
      const I = new Interface(MARKET_NATIVE_ABI)
      const data = side === 'yes' ? I.encodeFunctionData('buyYesWithBNB', []) : I.encodeFunctionData('buyNoWithBNB', [])
      const wc = walletClient || (await ensureWalletClient())
      if (!wc) throw new Error('Wallet client unavailable')
      const from = (wc.account?.address || address)?.toLowerCase()
      if (!from) throw new Error('Wallet address unavailable')
      const valueHex = `0x${amt.toString(16)}`

      const [nonceHex, gasPriceHex, gasLimitHex] = await Promise.all([
        rpcFetch('eth_getTransactionCount', [from, 'pending']),
        rpcFetch('eth_gasPrice', []),
        rpcFetch('eth_estimateGas', [{ from, to: marketAddr, data, value: valueHex }]),
      ])

      const legacyTx = {
        account: wc.account,
        chain: VIEM_BSC,
        to: marketAddr,
        data,
        value: amt,
        gas: hexToBigInt(gasLimitHex || '0x0'),
        gasPrice: hexToBigInt(gasPriceHex || '0x0'),
        nonce: hexToNumber(nonceHex || '0x0'),
        type: 0,
      }

      const signed = await wc.signTransaction(legacyTx)
      const hash = await rpcFetch('eth_sendRawTransaction', [signed])
      setTx(hash)
      setStatus('Purchase submitted')
      setTradeSuccess({ side, amount: normalizedAmount, timestamp: Date.now() })
      setTradeSuccessDone(false)
      if (pick?.id && marketAddr) {
        triggerCreatorFeeTracker({
          pickId: pick.id,
          txHash: hash.toLowerCase(),
          marketAddress: marketAddr.toLowerCase(),
        }).catch((err) => console.warn('[EvmTradePanel] creator-fee-tracker failed', err))
      }
      await refreshBalances(address)
      await fetchMarketState()
    } catch (e) {
      setStatus(e?.shortMessage || e?.message || 'Buy failed')
    } finally { setBusy(false) }
  }

  const handleBuyClick = async (side) => {
    if (buyDisabled) return
    triggerButtonEffect(side)
    await onBuy(side)
  }

  const handleClaimClick = () => {
    if (!address || !canClaim || claiming) return
    setClaimBurst(true)
    handleClaim().finally(() => {
      setTimeout(() => setClaimBurst(false), 450)
    })
  }

  const handleShareWin = () => {
    if (!claimSuccess?.amountBn) return
    const text = `I just won ${claimSuccess.amountBn} BNB predicting on picks.run! Place your first pick now to win like me!`
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  useEffect(() => { if (address) refreshBalances(address) }, [address, shareAddrs.yes, shareAddrs.no])

  // Track Privy embedded EVM wallet
  useEffect(() => {
    const evmWallets = (wallets || []).filter((w) => w?.type === 'ethereum')
    const embedded = evmWallets.find((w) => w?.walletClientType === 'privy') || evmWallets[0] || null
    setActiveWallet(embedded || null)
  }, [wallets])

  const winningShares = useMemo(() => {
    if (outcomeLabel === 'Yes') return yesShareRaw
    if (outcomeLabel === 'No') return noShareRaw
    if (outcomeLabel === 'Invalid') return yesShareRaw + noShareRaw
    return 0n
  }, [outcomeLabel, yesShareRaw, noShareRaw])

  const estimatedPayoutWei = useMemo(() => {
    if (outcomeLabel === 'Invalid') return winningShares
    if (outcomeLabel === 'Yes') {
      if (winningShares === 0n || totals.sYes === 0n) return 0n
      return ((totals.vaultYes + totals.vaultNo) * winningShares) / totals.sYes
    }
    if (outcomeLabel === 'No') {
      if (winningShares === 0n || totals.sNo === 0n) return 0n
      return ((totals.vaultYes + totals.vaultNo) * winningShares) / totals.sNo
    }
    return 0n
  }, [outcomeLabel, totals, winningShares])

  const estimatedPayout = formatUnits(estimatedPayoutWei, 18)
  const winningShareDisplay = formatUnits(winningShares, 18)
  const canClaim = outcomeLabel !== 'Pending' && winningShares > 0n

  const handleClaim = useCallback(async () => {
    if (!marketAddr) return
    try {
      setClaiming(true); setStatus('Claiming winnings…'); setTx(null); setClaimSuccess(null)
      if (!address) {
        await login()
        throw new Error('Privy wallet required')
      }
      if (!canClaim) throw new Error('No claimable shares')
      const wc = walletClient || (await ensureWalletClient())
      if (!wc) throw new Error('Wallet client unavailable')
      const from = (wc.account?.address || address)?.toLowerCase()
      if (!from) throw new Error('Wallet address unavailable')
      const claimContext = {
        market: marketAddr,
        claimant: from,
        outcomeLabel,
        winningShares: winningShares?.toString?.() || '0',
        estimatedPayoutWei: estimatedPayoutWei?.toString?.() || '0',
        vaultYes: totals.vaultYes?.toString?.() || '0',
        vaultNo: totals.vaultNo?.toString?.() || '0',
        totalYesShares: totals.sYes?.toString?.() || '0',
        totalNoShares: totals.sNo?.toString?.() || '0',
      }
      console.info('[EvmTradePanel] claim:start', claimContext)
      const data = marketInterface.encodeFunctionData('claim', [])
      const gasParams = { from, to: marketAddr, data }
      console.info('[EvmTradePanel] claim:gasEstimateParams', gasParams)
      const [nonceHex, gasPriceHex, gasLimitHex] = await Promise.all([
        rpcFetch('eth_getTransactionCount', [from, 'pending']),
        rpcFetch('eth_gasPrice', []),
        rpcFetch('eth_estimateGas', [gasParams]),
      ])
      const txReq = {
        account: wc.account,
        chain: VIEM_BSC,
        to: marketAddr,
        data,
        value: 0n,
        gas: hexToBigInt(gasLimitHex || '0x0'),
        gasPrice: hexToBigInt(gasPriceHex || '0x0'),
        nonce: hexToNumber(nonceHex || '0x0'),
        type: 0,
      }
      console.info('[EvmTradePanel] claim:txRequest', {
        to: txReq.to,
        gas: txReq.gas?.toString?.() || '0',
        gasPrice: txReq.gasPrice?.toString?.() || '0',
        nonce: txReq.nonce,
        value: txReq.value?.toString?.() || '0',
      })
      const signed = await wc.signTransaction(txReq)
      const hash = await rpcFetch('eth_sendRawTransaction', [signed])
      setTx(hash)
      setStatus('Claim submitted')
      const wonAmount = Number(estimatedPayout)
      setClaimSuccess({ amountBn: Number.isFinite(wonAmount) ? wonAmount.toFixed(4) : null })
      await refreshBalances(address)
      await fetchMarketState()
    } catch (err) {
      console.error('[EvmTradePanel] claim failed', err, {
        market: marketAddr,
        claimant: address,
        outcomeLabel,
        winningShares: winningShares?.toString?.() || '0',
        estimatedPayoutWei: estimatedPayoutWei?.toString?.() || '0',
      })
      setStatus(err?.shortMessage || err?.message || 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }, [marketAddr, login, address, canClaim, walletClient, ensureWalletClient, marketInterface, rpcFetch, fetchMarketState, totals, winningShares, estimatedPayoutWei, outcomeLabel])

  useEffect(() => {
    if (typeof onWalletSnapshot !== 'function') return
    const safeNumber = (value) => {
      const parsed = Number(value || 0)
      return Number.isFinite(parsed) ? parsed.toFixed(4) : '0.0000'
    }
    onWalletSnapshot({
      bnb: safeNumber(bnbBal),
      yesShares: shareAddrs.yes ? safeNumber(yesShareBal) : null,
      noShares: shareAddrs.no ? safeNumber(noShareBal) : null,
      outcome: outcomeLabel,
    })
  }, [onWalletSnapshot, bnbBal, yesShareBal, noShareBal, outcomeLabel, shareAddrs.yes, shareAddrs.no])

  return (
    <div className="space-y-5">
      {!address && (
        <div className="text-xs text-red-400">Privy wallet not ready. Log in to generate an embedded wallet.</div>
      )}
      {outcomeLabel === 'Pending' ? (
        <>
          {isNativeMarket ? (
            <>
              <div className="w-full max-w-[420px] mx-auto grid grid-cols-2 gap-2 sm:gap-4">
                <button
                  onClick={() => handleBuyClick('yes')}
                  disabled={!address || buyDisabled}
                  className={`relative overflow-hidden px-8 py-5 rounded-[1.25rem] bg-[#5ED4FF] text-slate-950 text-2xl font-semibold shadow-lg shadow-cyan-500/30 transition-transform hover:scale-[1.02] disabled:opacity-60 ${pressedButton === 'yes' ? 'scale-95' : ''}`}
                >
                  <span className="relative z-10">Yes</span>
                  {burst?.side === 'yes' && (
                    <span key={burst.ts} className="pointer-events-none absolute inset-0 rounded-[1.25rem] border-2 border-white/70 animate-ping opacity-60" />
                  )}
                </button>
                <button
                  onClick={() => handleBuyClick('no')}
                  disabled={!address || buyDisabled}
                  className={`relative overflow-hidden px-8 py-5 rounded-[1.25rem] bg-[#FF4F8B] text-white text-2xl font-semibold shadow-lg shadow-rose-500/30 transition-transform hover:scale-[1.02] disabled:opacity-60 ${pressedButton === 'no' ? 'scale-95' : ''}`}
                >
                  <span className="relative z-10">No</span>
                  {burst?.side === 'no' && (
                    <span key={`${burst.ts}-no`} className="pointer-events-none absolute inset-0 rounded-[1.25rem] border-2 border-white/70 animate-ping opacity-60" />
                  )}
                </button>
              </div>
              <div className="w-full max-w-[420px] mx-auto flex flex-col gap-4">
                <div className="flex items-center justify-center">
                  <div className="w-full max-w-[360px] bg-neutral-800 border border-neutral-700 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent text-white text-xl sm:text-2xl font-semibold placeholder:text-gray-600 focus:outline-none text-left"
                    />
                    <span className="shrink-0 whitespace-nowrap text-base sm:text-lg font-semibold text-yellow-300">BNB</span>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="px-3 py-1 rounded-full border border-green-bright/40 bg-green-bright/10 text-[11px] font-semibold uppercase tracking-[0.3em] text-green-bright">Quick buy</span>
                  <div className="grid grid-cols-4 gap-2 w-full max-w-[360px]">
                    {[0.01, 0.1, 0.2, 0.5].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setAmount(String(val))}
                        className="rounded-2xl border border-card-border bg-neutral-800 py-2 text-sm sm:text-base font-semibold text-white hover:border-green-bright hover:bg-neutral-700 transition-colors"
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/40 rounded px-3 py-2">
              Legacy WBNB markets are disabled. Relaunch this pick through the admin panel.
            </div>
          )}
          {tradingClosed && <div className="text-xs text-red-400 text-center">Trading closed</div>}
        </>
      ) : (
        <div className="space-y-4 text-center">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Claim Winnings</div>
            <div className="text-xs opacity-80">Claimable shares: {Number(winningShareDisplay).toFixed(4)}</div>
            <div className="text-xs opacity-80">Estimated payout: {Number(estimatedPayout).toFixed(6)} BNB</div>
          </div>
          <button
            onClick={handleClaimClick}
            disabled={!address || !canClaim || claiming}
            className={`relative overflow-hidden mx-auto w-full max-w-[360px] px-10 py-5 rounded-[1.75rem] text-2xl font-semibold text-white transition-transform bg-[#32F79A] shadow-lg shadow-emerald-500/30 disabled:opacity-60 ${claimBurst || claiming ? 'scale-95' : 'hover:scale-[1.02]'}`}
          >
            <span className="relative z-10">{claiming ? 'Claiming…' : 'Claim Winnings'}</span>
            {(claimBurst || claiming) && (
              <span className="pointer-events-none absolute inset-0 rounded-[1.75rem] border-2 border-white/70 animate-spin opacity-60" />
            )}
          </button>
          {!canClaim && <div className="text-xs text-red-400">You have no {outcomeLabel === 'Invalid' ? '' : outcomeLabel} shares to claim.</div>}
          {claimSuccess?.amountBn && (
            <div className="rounded-2xl border border-green-bright/40 bg-green-bright/10 px-4 py-3 text-center space-y-2">
              <div className="text-sm font-semibold text-white">Congratulations! You just won {claimSuccess.amountBn} BNB</div>
              <button
                type="button"
                onClick={handleShareWin}
                className="inline-flex items-center justify-center rounded-full border border-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10"
              >
                Share to X
              </button>
            </div>
          )}
        </div>
      )}
      {!!status && (
        <div className="text-xs text-white/80">{status}{tx ? <> – <a href={getBscScanTx(tx)} target="_blank" rel="noreferrer" className="underline">View TX</a></> : null}</div>
      )}
      {tradeSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-[2rem] border border-white/10 bg-neutral-950 px-10 py-8 text-center space-y-5 shadow-[0_40px_120px_rgba(0,0,0,0.8)]">
            <div className="relative mx-auto h-28 w-28">
              <div className={`absolute inset-0 rounded-full border-[10px] border-green-bright/40 border-t-transparent ${tradeSuccessDone ? 'border-green-bright animate-none' : 'animate-spin'}`}></div>
              {tradeSuccessDone && (
                <div className="absolute inset-0 flex items-center justify-center text-green-bright text-4xl font-bold">✓</div>
              )}
            </div>
            <div className="text-lg font-semibold text-white leading-relaxed">
              {tradeSuccessDone ? `All set! Your trade for ${Number(tradeSuccess.amount || 0).toFixed(4)} shares has been completed for ${Number(tradeSuccess.amount || 0).toFixed(4)} BNB.` : 'Submitting your trade…'}
            </div>
            {tradeSuccessDone && (
              <button
                type="button"
                onClick={() => { setTradeSuccess(null); setTradeSuccessDone(false) }}
                className="inline-flex items-center justify-center rounded-full bg-green-bright px-6 py-2 text-base font-semibold text-white hover:bg-green-bright/90"
              >
                Finish
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )}

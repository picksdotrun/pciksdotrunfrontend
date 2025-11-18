import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getBscScanTx } from '../lib/evm'
import { formatVolumeDisplay, formatFeeDisplay, formatBnbLabel } from '../lib/volumeFormat'

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')

const defaultEmptyCopy = {
  pick: 'No trades yet. Everything you execute will show up instantly.',
  user: 'No completed trades yet. Start trading to populate this history.',
}

export default function TradesTable({
  filterId,
  mode = 'pick', // 'pick' | 'user'
  limit = 100,
  title = 'Trades',
  maxHeight = '360px',
  emptyMessage,
  onMeta,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const column = mode === 'user' ? 'user_id' : 'pick_id'
  const emptyCopy = emptyMessage || defaultEmptyCopy[mode] || defaultEmptyCopy.pick

  const formatTimestamp = useCallback((value) => {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }, [])

  const formatRelativeTime = useCallback((value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (diffSeconds < 60) return 'just now'
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
    return `${Math.floor(diffSeconds / 86400)}d ago`
  }, [])

  const fetchTrades = useCallback(async () => {
    if (!filterId) {
      setRows([])
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      let query = supabase
        .from('trades')
        .select('*, user:users(id, display_name, username, avatar_url, wallet), pick:picks(id, name)')
        .eq(column, filterId)
        .order('occurred_at', { ascending: false })
        .limit(limit)
      const { data, error: qError } = await query
      if (qError) throw qError
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[TradesTable] fetch failed', err)
      setRows([])
      setError(err?.message || 'Failed to load trades')
    } finally {
      setLoading(false)
    }
  }, [column, filterId, limit])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades])

  useEffect(() => {
    if (!filterId) return undefined
    const channel = supabase
      .channel(`trades-${mode}-${filterId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades', filter: `${column}=eq.${filterId}` }, () => {
        fetchTrades()
      })
      .subscribe()
    return () => {
      try { supabase.removeChannel(channel) } catch (err) { console.warn('[TradesTable] removeChannel failed', err) }
    }
  }, [column, filterId, fetchTrades, mode])

  const totalVolumeWei = useMemo(
    () => rows.reduce((sum, row) => sum + BigInt(row?.amount_wei ?? 0), 0n),
    [rows],
  )
  const volumeDisplay = formatVolumeDisplay(totalVolumeWei.toString())

  useEffect(() => {
    if (typeof onMeta === 'function') {
      onMeta({ trades: rows.length, volumeLabel: volumeDisplay })
    }
  }, [onMeta, rows.length, volumeDisplay])

  const renderUserCell = (trade) => {
    const primary = trade?.user?.display_name || trade?.user?.username || shortAddress(trade?.user?.wallet || trade?.trader)
    const avatar = trade?.user?.avatar_url || null
    const address = trade?.user?.wallet || trade?.trader || ''
    const txUrl = trade?.tx_hash ? getBscScanTx(trade.tx_hash) : null
    return (
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full border border-white/10 overflow-hidden bg-white/5 flex-shrink-0 text-[11px] text-white flex items-center justify-center">
          {avatar ? <img src={avatar} alt={primary} className="w-full h-full object-cover" /> : primary.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0">
          {txUrl ? (
            <a href={txUrl} target="_blank" rel="noreferrer" className="text-sm text-white font-semibold truncate hover:underline">
              {primary}
            </a>
          ) : (
            <span className="text-sm text-white font-semibold truncate">{primary}</span>
          )}
          <span className="text-[11px] text-gray-400 uppercase tracking-wide">{shortAddress(address)}</span>
        </div>
      </div>
    )
  }

  const renderPickCell = (trade) => {
    const pickName = trade?.pick?.name || 'Unknown pick'
    return (
      <div className="flex flex-col truncate">
        <span className="text-sm text-white font-semibold truncate">{pickName}</span>
        <span className="text-[11px] text-gray-400 uppercase tracking-wide">{trade?.pick_id || '—'}</span>
      </div>
    )
  }

  const headerLabels = mode === 'user'
    ? ['Side', 'Size', 'Shares', 'Pick', 'Time']
    : ['Side', 'Size', 'Shares', 'Trader', 'Time']

  return (
    <div className="rounded-2xl border border-white/10 bg-neutral-900/40">
      <div className="flex items-center justify-between px-5 py-3 text-xs uppercase tracking-[0.2em] text-gray-400 border-b border-white/5">
        <span>{title}</span>
        {filterId && (
          <span className="text-[11px] text-gray-500">
            {rows.length} trades • {volumeDisplay}
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-3 px-5 py-4">
          {[...Array(4)].map((_, idx) => (
            <div key={idx} className="h-14 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="px-5 py-4 text-sm text-rose-300">{error}</div>
      ) : !filterId ? (
        <div className="px-5 py-4 text-sm text-gray-400">Select a {mode === 'user' ? 'user' : 'pick'} to view trades.</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-gray-400">{emptyCopy}</div>
      ) : (
        <div className="divide-y divide-white/5 overflow-y-auto" style={{ maxHeight }}>
          <div className="grid grid-cols-[110px_110px_110px_minmax(0,1fr)_120px] gap-3 px-5 py-3 text-[11px] uppercase tracking-[0.2em] text-gray-500 sticky top-0 bg-neutral-900/80 backdrop-blur">
            {headerLabels.map((label) => <span key={label} className={label === 'Size' || label === 'Shares' || label === 'Time' ? 'text-right' : ''}>{label}</span>)}
          </div>
          {rows.map((trade) => {
            const key = trade.id || `${trade.tx_hash}-${trade.log_index}`
            const sideLabel = trade.is_yes ? 'BUY YES' : 'BUY NO'
            const sideColor = trade.is_yes ? 'text-green-bright' : 'text-rose-400'
            return (
              <div key={key} className="grid grid-cols-[110px_110px_110px_minmax(0,1fr)_120px] gap-3 px-5 py-3 items-center text-sm">
                <div className={`font-semibold ${sideColor}`}>{sideLabel}</div>
                <div className="text-right font-mono text-white">
                  {formatBnbLabel(trade.amount_wei)}
                </div>
                <div className="text-right text-gray-200">
                  {formatBnbLabel(trade.shares_wei, 4, 'sh')}
                </div>
                {mode === 'user' ? renderPickCell(trade) : renderUserCell(trade)}
                <div className="text-right text-xs text-gray-400">
                  <div>{formatTimestamp(trade.occurred_at)}</div>
                  <div>{formatRelativeTime(trade.occurred_at)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

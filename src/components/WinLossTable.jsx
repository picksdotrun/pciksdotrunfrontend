import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatVolumeDisplay } from '../lib/volumeFormat'

const statusStyles = {
  win: 'bg-green-500/15 text-green-300 border border-green-400/30',
  loss: 'bg-rose-500/15 text-rose-300 border border-rose-400/30',
  pending: 'bg-white/10 text-white/70 border border-white/20',
}

export default function WinLossTable({ userId, limit = 25 }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const loadRows = useCallback(async () => {
    if (!userId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await supabase
        .from('win_loss_events')
        .select('id, pick_id, side, outcome, amount_wei, created_at, pick:picks(id, name, image, category, result)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (queryError) throw queryError
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[WinLossTable] load failed', err)
      setError(err?.message || 'Failed to load trade history')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [userId, limit])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  if (!userId) {
    return <div className="text-sm text-gray-400">Connect your profile to view history.</div>
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, idx) => (
          <div key={idx} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <div className="text-sm text-rose-300">{error}</div>
  }

  if (!rows.length) {
    return <div className="text-sm text-gray-400">No resolved predictions yet.</div>
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const pick = row.pick || {}
        const outcome = row.outcome || 'pending'
        const badgeClass = statusStyles[outcome] || statusStyles.pending
        const amountLabel = formatVolumeDisplay(row.amount_wei)
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => pick?.id && navigate(`/pick/${pick.id}`)}
            className="w-full text-left bg-neutral-900/40 border border-white/10 rounded-2xl px-4 py-3 hover:border-cyan-400/40 transition-colors flex items-center gap-3"
          >
            <div className="h-12 w-12 rounded-xl overflow-hidden bg-white/5 flex-shrink-0">
              {pick?.image ? (
                <img src={pick.image} alt={pick.name || 'Pick'} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-xs text-white/60">{(pick?.name || 'Pick').slice(0, 2).toUpperCase()}</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{pick?.name || 'Pick'}</div>
              <div className="text-xs text-gray-400">{new Date(row.created_at).toLocaleString()}</div>
            </div>
            <div className="text-right text-sm text-white/80">
              <div className="font-semibold">{amountLabel}</div>
              <div className="text-xs text-gray-400 capitalize">Side: {row.side}</div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeClass}`}>
              {outcome === 'win' ? 'Win' : outcome === 'loss' ? 'Loss' : 'Pending'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

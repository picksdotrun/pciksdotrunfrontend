import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FollowButton from './FollowButton'
import { formatVolumeDisplay } from '../lib/volumeFormat'

export default function Leaderboard() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [sortKey, setSortKey] = useState('volume')

  useEffect(() => {
    let mounted = true
    const fetchRows = async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, wallet, username, display_name, followers_count, picks_count, x_handle, avatar_url, trading_volume_wei, win_count, loss_count, win_amount_wei, loss_amount_wei')
        .order('trading_volume_wei', { ascending: false })
        .limit(200)
      if (!mounted) return
      if (!error) setRows(Array.isArray(data) ? data : [])
    }
    fetchRows()
    const channel = supabase
      .channel('users-leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, fetchRows)
      .subscribe()
    return () => { mounted = false; try { supabase.removeChannel(channel) } catch {} }
  }, [])

  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

  const processedRows = useMemo(() => {
    const clone = [...rows]
    if (sortKey === 'followers') {
      clone.sort((a, b) => Number(b.followers_count || 0) - Number(a.followers_count || 0))
    } else if (sortKey === 'winrate') {
      const rate = (row) => {
        const wins = Number(row.win_count || 0)
        const losses = Number(row.loss_count || 0)
        const total = wins + losses
        return total ? wins / total : 0
      }
      clone.sort((a, b) => rate(b) - rate(a))
    } else {
      clone.sort((a, b) => Number(b.trading_volume_wei || 0) - Number(a.trading_volume_wei || 0))
    }
    return clone
  }, [rows, sortKey])

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <div className="container mx-auto px-4 py-6 max-w-3xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h1 className="text-lg font-bold text-white">Leaderboard</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              { id: 'volume', label: 'Total volume' },
              { id: 'winrate', label: 'Win rate' },
              { id: 'followers', label: 'Followers' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSortKey(id)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                  sortKey === id
                    ? 'border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                    : 'border-card-border text-gray-300 hover:border-cyan-400/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden shadow-lg shadow-black/30">
          <div className="grid grid-cols-12 text-xs text-gray-secondary px-4 py-2 border-b border-card-border bg-surface-muted/60">
            <div className="col-span-1">#</div>
            <div className="col-span-4">User</div>
            <div className="col-span-2 text-right">Followers</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Win rate</div>
            <div className="col-span-1 text-right">Picks</div>
          </div>
          {processedRows.map((r, idx) => {
            const displayName = r.display_name || r.username || short(r.wallet)
            const initials = (displayName || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'SP'
            const winCount = Number(r.win_count || 0)
            const lossCount = Number(r.loss_count || 0)
            const totalTrades = winCount + lossCount
            const winRate = totalTrades ? Math.round((winCount / totalTrades) * 100) : 0
            const volumeLabel = formatVolumeDisplay(r.trading_volume_wei || 0)
            return (
              <button
              key={r.wallet || idx}
              type="button"
              onClick={() => navigate(`/profile/${r.wallet || ''}`)}
              className="grid grid-cols-12 items-center w-full text-left px-4 py-3 border-b border-card-border/50 hover:bg-surface-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-bright/60"
            >
              <div className="col-span-1 text-gray-secondary">{idx + 1}</div>
              <div className="col-span-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex w-8 h-8 rounded-full border border-card-border overflow-hidden bg-surface-muted text-[11px] uppercase items-center justify-center text-gray-200">
                    {r.avatar_url
                      ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      : initials}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="text-white font-medium hover:underline">{displayName}</div>
                    <FollowButton targetUserId={r.id} />
                  </div>
                  {r.x_handle && (
                    <a
                      href={`https://x.com/${r.x_handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-cyan-300 hover:text-white"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-500 text-[9px] font-semibold text-white">X</span>
                      <span className="font-medium">{r.x_handle}</span>
                    </a>
                  )}
                </div>
                <div className="text-[11px] text-gray-secondary">{short(r.wallet)}</div>
              </div>
              <div className="col-span-2 text-right text-gray-200 font-semibold">{Number(r.followers_count || 0).toLocaleString()}</div>
              <div className="col-span-2 text-right text-cyan-200 font-semibold">{volumeLabel}</div>
              <div className="col-span-2 text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  <span className={`text-sm font-semibold ${winRate >= 50 ? 'text-green-bright' : 'text-rose-300'}`}>{winRate}%</span>
                  <span className="text-[11px] text-gray-400">{winCount}W/{lossCount}L</span>
                </span>
              </div>
              <div className="col-span-1 text-right text-green-bright font-bold">{Number(r.picks_count || 0).toLocaleString()}</div>
            </button>
          )})}
          {rows.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-secondary">No users yet</div>
          )}
        </div>
      </div>
    </div>
  )
}

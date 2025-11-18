import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatUsdVolume } from '../lib/volumeFormat'

const PANEL_TITLES = ['Newly created', 'Following', 'Popular']
const PANEL_KEYS = ['newly', 'following', 'popular']

export default function AdvancedPanels({ followingWallet = null }) {
  const [order, setOrder] = useState([0,1,2])
  const [dragIdx, setDragIdx] = useState(null)
  const [overlay, setOverlay] = useState(null) // {idx, x, y, w, h, panelKey}
  const panelRefs = useRef([])
  const [panelData, setPanelData] = useState({
    newly: [],
    following: [],
    popular: [],
  })
  const [loading, setLoading] = useState(true)
  const [amounts, setAmounts] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('picks')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(60)
        if (error) throw error
        if (!isMounted) return
        const picks = Array.isArray(data) ? data : []
        const sortBy = (arr, fn) => [...arr].sort((a, b) => fn(b) - fn(a))
        const getNumber = (...vals) => {
          for (const v of vals) {
            const num = Number(v ?? 0)
            if (!Number.isNaN(num) && num !== 0) return num
          }
          return 0
        }
        const newly = sortBy(picks, (p) => new Date(p.created_at || 0).getTime()).slice(0, 6)
        const following =
          (followingWallet
            ? picks.filter((p) => (p.creator_wallet || '').toLowerCase() === followingWallet.toLowerCase())
            : []
          ).slice(0, 6)
        const popular = sortBy(
          picks,
          (p) => getNumber(p.holders_count, p.volume_24h),
        ).slice(0, 6)
        setPanelData({ newly, following, popular })
      } catch (e) {
        console.error('[AdvancedPanels] failed to load picks', e)
        setPanelData({ newly: [], following: [], popular: [] })
      } finally {
        if (isMounted) setLoading(false)
      }
    })()
    return () => { isMounted = false }
  }, [followingWallet])

  const onDragStart = (idx) => (e) => {
    const el = panelRefs.current[idx]
    const rect = el?.getBoundingClientRect()
    setDragIdx(idx)
    if (rect) {
      setOverlay({ idx, x: e.clientX - rect.width/2, y: e.clientY - 24, w: rect.width, h: rect.height, panelKey: order[idx] })
    }
    // Hide default ghost
    const img = new Image()
    img.src = ''
    e.dataTransfer.setDragImage(img, 0, 0)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOverGrid = (e) => {
    if (!overlay) return
    e.preventDefault()
    setOverlay((o) => o ? { ...o, x: e.clientX - o.w/2, y: e.clientY - 24 } : o)
  }
  const onDragOver = (overIdx) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (dropIdx) => (e) => {
    e.preventDefault()
    if (dragIdx == null || dragIdx === dropIdx) { setOverlay(null); setDragIdx(null); return }
    const current = [...order]
    const [moved] = current.splice(dragIdx, 1)
    current.splice(dropIdx, 0, moved)
    setOrder(current)
    setDragIdx(null)
    setOverlay(null)
  }
  const onDragEnd = () => { setDragIdx(null); setOverlay(null) }

  const handleAmountChange = (pickId) => (e) => {
    const value = e.target.value
    setAmounts((prev) => ({ ...prev, [pickId]: value }))
  }

  const handleQuickBuy = (pick, side) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const amount = amounts[pick.id] || ''
    const params = new URLSearchParams()
    if (side) params.set('side', side)
    if (amount) params.set('amount', amount)
    navigate(`/pick/${pick.id}${params.size ? `?${params.toString()}` : ''}`)
  }

  const panelContent = (panelKey) => {
    const key = PANEL_KEYS[panelKey] ?? 'newly'
    const picks = panelData[key] || []
    if (loading) {
      return (
        <div className="space-y-2 mt-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-16 bg-muted/40 rounded-lg animate-pulse" />
          ))}
        </div>
      )
    }
    if (!picks.length) {
      return <div className="mt-2 text-sm text-gray-secondary">No picks available yet.</div>
    }
    return (
      <div className="mt-2 space-y-3">
        {picks.map((pick) => (
          <PanelPickRow key={pick.id} pick={pick} />
        ))}
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-4" onDragOver={onDragOverGrid} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {order.map((panelKey, idx) => (
          <div
            key={idx}
            ref={(el) => (panelRefs.current[idx] = el)}
            className={`bg-card-bg border border-card-border rounded-xl min-h-[60vh] relative ring-2 ring-green-bright ${dragIdx===idx ? 'opacity-50' : ''}`}
            onDragOver={onDragOver(idx)}
            onDrop={onDrop(idx)}
          >
            <button
              draggable
              onDragStart={onDragStart(idx)}
              className="absolute top-2 left-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-200 p-1"
              aria-label="Drag panel"
              onMouseDown={(e)=>e.stopPropagation()}
            >
              <DragHandleDots />
            </button>
            <div className="p-4 pl-10">
              <h3 className="text-white font-semibold mb-3">{PANEL_TITLES[panelKey]}</h3>
              <div className="text-gray-500 text-sm">Drag the dot grid to reorder these panels.</div>
              {panelContent(panelKey)}
            </div>
          </div>
        ))}
      </div>
      {overlay && (
        <div
          className="pointer-events-none fixed z-50 shadow-xl ring-2 ring-green-bright rounded-xl bg-card-bg border border-card-border"
          style={{ width: overlay.w, height: overlay.h, left: overlay.x, top: overlay.y }}
        >
          <div className="p-4 pl-10">
            <div className="absolute top-2 left-2 text-gray-500"><DragHandleDots /></div>
            <h3 className="text-white font-semibold mb-3">{PANEL_TITLES[overlay.panelKey]}</h3>
            <div className="text-gray-500 text-sm mb-2">Drag the dot grid to reorder these panels.</div>
            {panelContent(overlay.panelKey)}
          </div>
        </div>
      )}
    </div>
  )
}

function DragHandleDots() {
  const dots = []
  for (let i=0;i<9;i++) dots.push(<span key={i} className="inline-block w-1.5 h-1.5 bg-gray-400 m-0.5 rounded-sm" />)
  return <div className="inline-flex flex-wrap w-6 h-6 items-center content-center" aria-label="Drag panel">{dots}</div>
}

function PanelPickRow({ pick }) {
  const totalVolumeLabel = formatUsdVolume(pick?.trading_volume_wei ?? pick?.total_volume_wei)
  const hasVolume = totalVolumeLabel && totalVolumeLabel !== '—'
  return (
    <article className="flex items-center gap-3 rounded-2xl border border-card-border/60 bg-card-bg/90 p-3 hover:border-green-bright/60 transition-colors">
      <Link to={`/pick/${pick.id}`} className="flex items-center gap-3 flex-1 min-w-0">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl border border-card-border/60 bg-gradient-to-br from-slate-900 via-slate-800 to-black">
          {pick?.image ? (
            <img src={pick.image} alt={pick.name || 'Prediction'} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.4em] text-gray-600">
              No art
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white truncate">{pick?.name || 'Untitled pick'}</span>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">{pick?.category || 'General'}</span>
          </div>
          {pick?.description && (
            <p className="text-xs text-gray-300 line-clamp-2 mt-1">{pick.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
            <span>Status: <span className="text-gray-100">{(pick.status || 'open').toUpperCase()}</span></span>
            <span>Line: <span className="text-gray-100">{pick.line ?? '—'}</span></span>
            <span>Created {new Date(pick.created_at || Date.now()).toLocaleDateString()}</span>
            {hasVolume && (
              <span>Volume: <span className="text-gray-100">{totalVolumeLabel} Volume</span></span>
            )}
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-2 ml-auto">
        <button className="rounded-md bg-green-bright/20 border border-green-bright text-xs font-semibold text-green-bright px-2.5 py-1.5 hover:bg-green-bright/30">
          Yes
        </button>
        <button className="rounded-md bg-card border border-card-border text-xs font-semibold text-gray-200 px-2.5 py-1.5 hover:border-green-bright/60">
          No
        </button>
      </div>
    </article>
  )
}

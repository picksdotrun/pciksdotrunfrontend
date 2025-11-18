import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ColorType, CrosshairMode, LineType, createChart } from 'lightweight-charts'
import { supabase } from '../lib/supabase'
import { formatVolumeDisplay } from '../lib/volumeFormat'

const CHART_HEIGHT = 260
const BASELINE_SECONDS_GAP = 60
const SMOOTHING_SUBDIVISIONS = 4
const LINE_ANIMATION_DURATION = 280
const MAX_MARKER_COUNT = 28
const SERIES_VISUALS = {
  yes: {
    coreColor: '#42fdb2',
    haloColor: 'rgba(66,253,178,0.25)',
    coreWidth: 2,
    haloWidth: 7,
  },
  no: {
    coreColor: '#ff7aa5',
    haloColor: 'rgba(255,122,165,0.25)',
    coreWidth: 2,
    haloWidth: 7,
  },
}

const shortWallet = (value) => (value ? `${value.slice(0, 4)}…${value.slice(-4)}` : 'Unnamed')

const formatBnb = (value) => {
  if (!Number.isFinite(value)) return '0.000'
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.01) return value.toFixed(3)
  return value.toFixed(4)
}

const formatMarkerTimestamp = (value) => {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const interpretYesTradeFlag = (value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true
    if (normalized === 'false' || normalized === 'no' || normalized === '0') return false
  }
  return Boolean(value)
}

const toUnixTime = (value, fallback) => {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return Math.floor(date.getTime() / 1000)
}

const buildBaselineSeries = () => {
  const now = Math.floor(Date.now() / 1000)
  return [
    { time: now - BASELINE_SECONDS_GAP, value: 0 },
    { time: now, value: 0 },
  ]
}

const parseRowTimestamp = (row, fallbackMs) => {
  if (!row) return fallbackMs
  const value = row.created_at || row.occurred_at
  if (!value) return fallbackMs
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return fallbackMs
  return parsed
}

const catmullRom = (p0, p1, p2, p3, t) => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  )
}

const smoothSeries = (points, subdivisions = SMOOTHING_SUBDIVISIONS) => {
  if (!Array.isArray(points) || points.length === 0) {
    return { points: [], anchors: [] }
  }
  const normalised = points.map((point) => ({ time: Math.round(point.time), value: point.value }))
  if (normalised.length === 1 || subdivisions <= 0) {
    return {
      points: normalised,
      anchors: normalised.map((point, index) => ({ sourceIndex: index, resultIndex: index, time: point.time, value: point.value })),
    }
  }
  const result = []
  const anchors = []
  let lastTime = Number.NEGATIVE_INFINITY
  const push = (time, value, sourceIndex = null) => {
    const rounded = Math.round(time)
    const safeTime = rounded <= lastTime ? lastTime + 1 : rounded
    lastTime = safeTime
    const entry = { time: safeTime, value }
    result.push(entry)
    if (sourceIndex != null) {
      anchors.push({ sourceIndex, resultIndex: result.length - 1, time: safeTime, value })
    }
  }
  push(normalised[0].time, normalised[0].value, 0)
  for (let i = 0; i < normalised.length - 1; i += 1) {
    const p0 = normalised[i - 1] ?? normalised[i]
    const p1 = normalised[i]
    const p2 = normalised[i + 1]
    const p3 = normalised[i + 2] ?? p2
    for (let step = 1; step <= subdivisions; step += 1) {
      const t = step / (subdivisions + 1)
      const interpolatedValue = catmullRom(p0.value, p1.value, p2.value, p3.value, t)
      const interpolatedTime = p1.time + (p2.time - p1.time) * t
      push(interpolatedTime, interpolatedValue, null)
    }
    push(p2.time, p2.value, i + 1)
  }
  return { points: result, anchors }
}

const blendSeriesData = (fromData, toData, progress) => {
  if (!fromData?.length) return toData
  if (!toData?.length) return fromData
  const clamped = Math.min(Math.max(progress, 0), 1)
  const maxLength = Math.max(fromData.length, toData.length)
  const fallbackFrom = fromData[fromData.length - 1]
  const fallbackTo = toData[toData.length - 1]
  const blended = []
  let lastTime = Number.NEGATIVE_INFINITY
  for (let i = 0; i < maxLength; i += 1) {
    const target = toData[i] ?? fallbackTo
    const origin = fromData[i] ?? fallbackFrom
    const timeCandidate = target?.time ?? origin.time
    const safeTime = timeCandidate <= lastTime ? lastTime + 1 : timeCandidate
    lastTime = safeTime
    const originValue = origin?.value ?? 0
    const targetValue = target?.value ?? originValue
    const value = originValue + (targetValue - originValue) * clamped
    blended.push({ time: safeTime, value })
  }
  return blended
}

function BurningTip({ color, position, size = 20, coreColor = '#ffffff', glowColor = color, pulseDuration = 1400 }) {
  if (!position) return null
  const half = size / 2
  const tailAngle = position.prev
    ? Math.atan2(position.prev.y - position.y, position.prev.x - position.x)
    : null
  const tailLength = size * 1.6
  const tailThickness = size * 0.3
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: (position.x ?? 0) - half,
        top: (position.y ?? 0) - half,
        width: size,
        height: size,
      }}
    >
      {tailAngle != null && (
        <div
          className="absolute"
          style={{
            width: tailLength,
            height: tailThickness,
            left: half,
            top: half - tailThickness / 2,
            background: `linear-gradient(90deg, ${glowColor}, transparent)`,
            filter: 'blur(4px)',
            transformOrigin: 'left center',
            transform: `rotate(${tailAngle}rad)`
          }}
        />
      )}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${coreColor} 0%, ${color} 50%, rgba(0,0,0,0) 75%)`,
          boxShadow: `0 0 10px ${glowColor}, 0 0 24px ${glowColor}`,
          animation: `burn-glow ${pulseDuration}ms ease-in-out infinite alternate`,
          border: `1px solid ${glowColor}`,
          '--burn-core': glowColor,
          '--burn-flare': `${glowColor}`,
        }}
      />
    </div>
  )
}

function AvatarMarker({ marker }) {
  if (!marker) return null
  const size = 28
  const half = size / 2
  const accentColor = marker.side === 'yes' ? SERIES_VISUALS.yes.coreColor : SERIES_VISUALS.no.coreColor
  const displayName = marker.displayName || shortWallet(marker.user?.wallet)
  const initials = displayName?.slice(0, 2)?.toUpperCase() || '??'
  const inlineLabel = `${marker.sideLabel} ${formatBnb(marker.amountBnb)} BNB`
  const body = (
    <>
      <span className="absolute left-1/2 -translate-x-1/2 -top-6 text-[11px] font-semibold text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]">
        {inlineLabel}
      </span>
      <div
        className="relative h-full w-full rounded-full overflow-hidden border-[1.5px] bg-slate-900/90 text-[11px] font-semibold text-white flex items-center justify-center shadow-[0_12px_25px_rgba(0,0,0,0.6)]"
        style={{ borderColor: accentColor }}
      >
        {marker.user?.avatar_url ? (
          <img src={marker.user.avatar_url} alt={displayName} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          initials
        )}
      </div>
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-[90px] w-48 -translate-y-2 whitespace-normal rounded-2xl border border-white/10 bg-gray-900/90 px-4 py-3 text-[11px] text-white opacity-0 shadow-[0_15px_35px_rgba(0,0,0,0.65)] transition-opacity duration-150 group-hover:opacity-100">
        <div className="text-sm font-semibold text-white mb-1">{displayName}</div>
        <div className="text-[11px] text-gray-200">{marker.sideText} at {marker.tooltipTime}</div>
        <div className="text-[11px] text-gray-200">Size {formatBnb(marker.amountBnb)} BNB</div>
      </div>
    </>
  )
  const style = {
    left: (marker.x ?? 0) - half,
    top: (marker.y ?? 0) - half - 10,
    width: size,
    height: size,
    pointerEvents: 'auto',
  }
  if (marker.profilePath) {
    return (
      <Link
        to={marker.profilePath}
        className="group absolute block pointer-events-auto"
        style={style}
        aria-label={`View ${displayName}'s profile`}
      >
        {body}
      </Link>
    )
  }
  return (
    <div className="group absolute pointer-events-auto" style={style}>
      {body}
    </div>
  )
}

export default function PickPriceChart({ pickId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tipPositions, setTipPositions] = useState({ yes: null, no: null })
  const [markerPositions, setMarkerPositions] = useState([])
  const [showTraders, setShowTraders] = useState(true)
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
  const yesSeriesRef = useRef(null)
  const yesHaloSeriesRef = useRef(null)
  const noSeriesRef = useRef(null)
  const noHaloSeriesRef = useRef(null)
  const resizeObserverRef = useRef(null)
  const yesLineDataRef = useRef([])
  const noLineDataRef = useRef([])
  const previousLineDataRef = useRef({ yes: [], no: [] })
  const liveLineDataRef = useRef({ yes: [], no: [] })
  const lineAnimationFrameRef = useRef(null)
  const markerDataRef = useRef([])

  const recomputeTips = useCallback((yesData, noData) => {
    if (!chartRef.current || !yesSeriesRef.current || !noSeriesRef.current) return
    const next = { yes: null, no: null }
    const yesPoint = yesData[yesData.length - 1]
    const yesPrevPoint = yesData[yesData.length - 2]
    const noPoint = noData[noData.length - 1]
    const noPrevPoint = noData[noData.length - 2]
    if (yesPoint) {
      const x = chartRef.current.timeScale().timeToCoordinate(yesPoint.time)
      const y = yesSeriesRef.current.priceToCoordinate(yesPoint.value)
      let prev = null
      if (yesPrevPoint) {
        const prevX = chartRef.current.timeScale().timeToCoordinate(yesPrevPoint.time)
        const prevY = yesSeriesRef.current.priceToCoordinate(yesPrevPoint.value)
        if (prevX != null && prevY != null) prev = { x: prevX, y: prevY }
      }
      if (x != null && y != null) next.yes = { x, y, prev }
    }
    if (noPoint) {
      const x = chartRef.current.timeScale().timeToCoordinate(noPoint.time)
      const y = noSeriesRef.current.priceToCoordinate(noPoint.value)
      let prev = null
      if (noPrevPoint) {
        const prevX = chartRef.current.timeScale().timeToCoordinate(noPrevPoint.time)
        const prevY = noSeriesRef.current.priceToCoordinate(noPrevPoint.value)
        if (prevX != null && prevY != null) prev = { x: prevX, y: prevY }
      }
      if (x != null && y != null) next.no = { x, y, prev }
    }
    setTipPositions(next)
  }, [])

  const toggleShowTraders = useCallback(() => {
    setShowTraders((prev) => !prev)
  }, [])

  const recomputeMarkerPositions = useCallback((markersInput) => {
    if (!showTraders || !chartRef.current || !chartContainerRef.current) {
      setMarkerPositions([])
      return
    }
    const markers = Array.isArray(markersInput) ? markersInput : markerDataRef.current
    if (!markers?.length) {
      setMarkerPositions([])
      return
    }
    const width = chartContainerRef.current.getBoundingClientRect().width
    const height = chartContainerRef.current.getBoundingClientRect().height
    const timeScale = chartRef.current.timeScale()
    const limited = markers.slice(-MAX_MARKER_COUNT)
    const next = []
    limited.forEach((marker) => {
      const series = marker.side === 'yes' ? yesSeriesRef.current : noSeriesRef.current
      if (!series) return
      const x = timeScale.timeToCoordinate(marker.time)
      const y = series.priceToCoordinate(marker.value)
      if (x == null || y == null) return
      if (x < -16 || x > width + 16 || y < -16 || y > height + 16) return
      next.push({ ...marker, x, y })
    })
    setMarkerPositions(next)
  }, [showTraders])

  const hydrateTradeUser = useCallback(async (row) => {
    if (!row || row.user || !row.user_id) return row
    try {
      const { data } = await supabase
        .from('users')
        .select('id, display_name, username, avatar_url, wallet')
        .eq('id', row.user_id)
        .maybeSingle()
      return { ...row, user: data || null }
    } catch (err) {
      console.error('[PickPriceChart] Failed to hydrate trade user', err)
      return row
    }
  }, [])

  useEffect(() => {
    if (!pickId) return
    let active = true
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('trades')
        .select('id, created_at, occurred_at, amount_wei, is_yes, yes_price_bps, no_price_bps, trader, user_id, user:users(id, display_name, username, avatar_url, wallet)')
        .eq('pick_id', pickId)
        .order('created_at', { ascending: true })
      if (!active) return
      if (!error && Array.isArray(data)) {
        setRows(data)
      } else {
        setRows([])
      }
      setLoading(false)
    })()
    const channel = supabase
      .channel(`price-history:${pickId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `pick_id=eq.${pickId}` },
        async (payload) => {
          const rawRow = payload?.new
          if (!rawRow?.id) return
          const newRow = await hydrateTradeUser(rawRow)
          setRows((prev) => {
            const found = prev.find((row) => row.id === newRow.id)
            if (found && Date.parse(found.created_at || '') === Date.parse(newRow.created_at || '')) return prev
            const merged = [...prev.filter((row) => row.id !== newRow.id), newRow]
        return merged.sort((a, b) => {
          const diff = parseRowTimestamp(a, 0) - parseRowTimestamp(b, 0)
          return diff !== 0 ? diff : a.id.localeCompare(b.id)
        })
      })
        },
      )
      .subscribe()
    return () => {
      active = false
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [pickId, hydrateTradeUser])

  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return
    const container = chartContainerRef.current
    const chart = createChart(container, {
      width: container.clientWidth || container.getBoundingClientRect().width || 320,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9fb3d4',
        fontFamily: 'var(--font-sans, Inter, ui-sans-serif)',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.08)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255,255,255,0.3)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1f2937',
        },
        horzLine: {
          color: 'rgba(255,255,255,0.2)',
          labelBackgroundColor: '#1f2937',
        },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
        minBarSpacing: 0.1,
        rightOffset: 6,
      },
    })
    const yesHaloSeries = chart.addLineSeries({
      color: SERIES_VISUALS.yes.haloColor,
      lineWidth: SERIES_VISUALS.yes.haloWidth,
      lineType: LineType.Curved,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const yesSeries = chart.addLineSeries({
      color: SERIES_VISUALS.yes.coreColor,
      lineWidth: SERIES_VISUALS.yes.coreWidth,
      lineType: LineType.Curved,
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const noHaloSeries = chart.addLineSeries({
      color: SERIES_VISUALS.no.haloColor,
      lineWidth: SERIES_VISUALS.no.haloWidth,
      lineType: LineType.Curved,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const noSeries = chart.addLineSeries({
      color: SERIES_VISUALS.no.coreColor,
      lineWidth: SERIES_VISUALS.no.coreWidth,
      lineType: LineType.Curved,
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const applyWidthFromContainer = () => {
      if (!chartContainerRef.current) return
      const bounds = chartContainerRef.current.getBoundingClientRect()
      const width = Math.max(Math.floor(bounds.width), 320)
      chart.applyOptions({ width })
      recomputeMarkerPositions(markerDataRef.current)
    }
    applyWidthFromContainer()

    let windowResizeAttached = false
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => applyWidthFromContainer())
      resizeObserver.observe(chartContainerRef.current)
      resizeObserverRef.current = resizeObserver
    } else {
      window.addEventListener('resize', applyWidthFromContainer)
      windowResizeAttached = true
    }

    chartRef.current = chart
    yesHaloSeriesRef.current = yesHaloSeries
    yesSeriesRef.current = yesSeries
    noHaloSeriesRef.current = noHaloSeries
    noSeriesRef.current = noSeries
    const handleRangeChange = () => {
      recomputeTips(yesLineDataRef.current || [], noLineDataRef.current || [])
      recomputeMarkerPositions(markerDataRef.current)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange)
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
      if (windowResizeAttached) {
        window.removeEventListener('resize', applyWidthFromContainer)
      }
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange) } catch {}
      chart.remove()
      chartRef.current = null
      yesSeriesRef.current = null
      yesHaloSeriesRef.current = null
      noSeriesRef.current = null
      noHaloSeriesRef.current = null
    }
  }, [recomputeTips, recomputeMarkerPositions])

  const applySeriesData = useCallback((yesData, noData) => {
    if (yesSeriesRef.current) yesSeriesRef.current.setData(yesData)
    if (yesHaloSeriesRef.current) yesHaloSeriesRef.current.setData(yesData)
    if (noSeriesRef.current) noSeriesRef.current.setData(noData)
    if (noHaloSeriesRef.current) noHaloSeriesRef.current.setData(noData)
    liveLineDataRef.current = { yes: yesData, no: noData }
  }, [])

  const { yesLineData, noLineData, totalVolumeDisplay, hasTrades, latestYesValue, latestNoValue, tradeMarkers } = useMemo(() => {
    if (!rows.length) {
      const baseline = buildBaselineSeries()
      const { points } = smoothSeries(baseline, 0)
      return {
        yesLineData: points,
        noLineData: points,
        tradeMarkers: [],
        totalVolumeDisplay: formatVolumeDisplay('0'),
        hasTrades: false,
        latestYesValue: 0,
        latestNoValue: 0,
      }
    }
    let totalAmount = 0n
    let yesVolume = 0n
    let noVolume = 0n
    const weiToBnb = (value) => {
      try {
        return Number(value) / 1e18
      } catch {
        return 0
      }
    }
    const yesPoints = []
    const noPoints = []
    const markerSeeds = []
    const firstRowMs = parseRowTimestamp(rows[0], Date.now())
    const firstFallbackTime = Math.floor(firstRowMs / 1000)

    rows.forEach((row, idx) => {
      const chartTime = toUnixTime(row.created_at || row.occurred_at, firstFallbackTime + idx)
      const amountWei = BigInt(row.amount_wei || 0)
      totalAmount += amountWei
      const isYesTrade = interpretYesTradeFlag(row.is_yes)
      if (isYesTrade) {
        yesVolume += amountWei
      } else {
        noVolume += amountWei
      }
      const yesValue = weiToBnb(yesVolume)
      const noValue = weiToBnb(noVolume)
      yesPoints.push({ time: chartTime, value: yesValue })
      noPoints.push({ time: chartTime, value: noValue })
      if (row.user) {
        const wallet = row.user.wallet || row.trader || ''
        const displayName = row.user.display_name || row.user.username || shortWallet(wallet)
        const tradeAmountBnb = weiToBnb(amountWei)
        const sideLabel = isYesTrade ? 'BY' : 'BN'
        const sideText = isYesTrade ? 'bought YES' : 'bought NO'
        const timestampSource = row.created_at || row.occurred_at || null
        markerSeeds.push({
          id: row.id,
          pointIndex: idx,
          side: isYesTrade ? 'yes' : 'no',
          sideLabel,
          sideText,
          user: row.user,
          displayName,
          amountBnb: tradeAmountBnb,
          tooltipTime: formatMarkerTimestamp(timestampSource),
          profilePath: row.user.wallet ? `/profile/${row.user.wallet}` : null,
          baseTime: chartTime,
          baseValue: isYesTrade ? yesValue : noValue,
        })
      }
    })

    const referenceSeries = yesPoints.length >= noPoints.length ? yesPoints : noPoints
    const fallbackTemplate = referenceSeries.length ? referenceSeries : buildBaselineSeries()
    const yesBaseLine = yesPoints.length ? yesPoints : fallbackTemplate.map(({ time }) => ({ time, value: 0 }))
    const noBaseLine = noPoints.length ? noPoints : fallbackTemplate.map(({ time }) => ({ time, value: 0 }))
    const { points: yesLineData, anchors: yesAnchors } = smoothSeries(yesBaseLine)
    const { points: noLineData, anchors: noAnchors } = smoothSeries(noBaseLine)
    const yesAnchorMap = Object.create(null)
    yesAnchors.forEach((anchor) => { yesAnchorMap[anchor.sourceIndex] = anchor })
    const noAnchorMap = Object.create(null)
    noAnchors.forEach((anchor) => { noAnchorMap[anchor.sourceIndex] = anchor })
    const tradeMarkers = markerSeeds.map((marker) => {
      const lookup = marker.side === 'yes' ? yesAnchorMap : noAnchorMap
      const anchor = lookup?.[marker.pointIndex]
      return {
        ...marker,
        time: anchor?.time ?? marker.baseTime,
        value: anchor?.value ?? marker.baseValue,
      }
    })
    const volumeLabel = formatVolumeDisplay(totalAmount.toString())

    return {
      yesLineData,
      noLineData,
      tradeMarkers,
      totalVolumeDisplay: volumeLabel,
      hasTrades: true,
      latestYesValue: yesLineData[yesLineData.length - 1]?.value ?? 0,
      latestNoValue: noLineData[noLineData.length - 1]?.value ?? 0,
    }
  }, [rows])

  useEffect(() => {
    markerDataRef.current = tradeMarkers || []
    recomputeMarkerPositions(tradeMarkers || [])
  }, [tradeMarkers, showTraders, recomputeMarkerPositions])

  useEffect(() => {
    if (!chartRef.current || !yesSeriesRef.current || !noSeriesRef.current) return
    yesLineDataRef.current = yesLineData
    noLineDataRef.current = noLineData

    const startAnimation = () => {
      const previous = previousLineDataRef.current
      const hasHistory = previous.yes.length && previous.no.length
      if (!hasHistory) {
        applySeriesData(yesLineData, noLineData)
        recomputeTips(yesLineData, noLineData)
        previousLineDataRef.current = { yes: yesLineData, no: noLineData }
        chartRef.current?.timeScale().fitContent()
        return
      }
      if (lineAnimationFrameRef.current) {
        cancelAnimationFrame(lineAnimationFrameRef.current)
        lineAnimationFrameRef.current = null
      }
      const start = performance.now()
      const animate = () => {
        const now = performance.now()
        const elapsed = now - start
        const progress = Math.min(Math.max(elapsed / LINE_ANIMATION_DURATION, 0), 1)
        const interpolatedYes = blendSeriesData(previous.yes, yesLineData, progress)
        const interpolatedNo = blendSeriesData(previous.no, noLineData, progress)
        applySeriesData(interpolatedYes, interpolatedNo)
        recomputeTips(interpolatedYes, interpolatedNo)
        if (progress < 1) {
          lineAnimationFrameRef.current = requestAnimationFrame(animate)
        } else {
          lineAnimationFrameRef.current = null
          previousLineDataRef.current = { yes: yesLineData, no: noLineData }
          chartRef.current?.timeScale().fitContent()
        }
      }
      lineAnimationFrameRef.current = requestAnimationFrame(animate)
    }

    startAnimation()

    return () => {
      if (lineAnimationFrameRef.current) {
        cancelAnimationFrame(lineAnimationFrameRef.current)
        lineAnimationFrameRef.current = null
      }
      previousLineDataRef.current = liveLineDataRef.current
    }
  }, [yesLineData, noLineData, recomputeTips, applySeriesData])

  return (
    <div className="rounded-[1.75rem] border border-card-border bg-card-bg/80 shadow-[0_25px_80px_-45px_rgba(0,0,0,0.85)] overflow-hidden">
      <div className="px-6 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.35em] text-gray-400">Prediction flow</div>
          <div className="text-2xl font-semibold text-white">Sentiment timeline</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Trades</div>
          <div className="text-sm font-semibold text-cyan-200">{rows.length} trades • {totalVolumeDisplay}</div>
        </div>
      </div>
      <div className="px-6 pb-3 flex flex-wrap items-center justify-between gap-4 text-[11px] text-gray-400">
        <div className="flex items-center gap-3">
          <span className="uppercase tracking-[0.3em] text-gray-500">Show traders</span>
          <button
            type="button"
            onClick={toggleShowTraders}
            aria-pressed={showTraders}
            aria-label="Toggle trader markers"
            className={`relative h-7 w-14 rounded-full border border-white/10 transition-colors duration-200 ${showTraders ? 'bg-cyan-400/40' : 'bg-white/10'}`}
          >
            <span
              className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${showTraders ? 'left-8 bg-cyan-100 drop-shadow-[0_0_12px_rgba(34,211,238,0.7)]' : 'left-1 bg-slate-200'}`}
            />
          </button>
        </div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-gray-500">
          BY = Bought YES • BN = Bought NO
        </div>
      </div>
      <div className="px-3 pb-4">
        <div className="relative rounded-2xl overflow-hidden">
          <div ref={chartContainerRef} className="w-full h-[260px]" />
          {showTraders && markerPositions.length > 0 && (
            <div className="absolute inset-0 pointer-events-none z-10">
              {markerPositions.map((marker) => (
                <AvatarMarker key={`${marker.id}-${marker.side}`} marker={marker} />
              ))}
            </div>
          )}
          <BurningTip color="rgba(66,253,178,0.9)" position={tipPositions.yes} />
          <BurningTip color="rgba(255,122,165,0.9)" position={tipPositions.no} />
          {loading && (
            <div className="absolute inset-0 rounded-2xl bg-surface-muted/40 animate-pulse" />
          )}
          {!loading && !hasTrades && (
            <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-gray-400 pointer-events-none">
              <div className="px-6 py-3 rounded-full bg-black/50 border border-white/10">
                No trades yet — both YES and NO lines are staged at 0% until the first fill lands.
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="px-6 pb-5 flex flex-col gap-4 text-xs text-gray-400 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-6 text-sm text-white/90">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-6 rounded-full bg-green-bright" />
            YES volume <strong className="text-white">{latestYesValue.toFixed(3)} BNB</strong>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-6 rounded-full bg-rose-400" />
            NO volume <strong className="text-white">{latestNoValue.toFixed(3)} BNB</strong>
          </div>
        </div>
        <div className="text-[11px] uppercase tracking-[0.3em] text-gray-500">
          Timeline updates in real time with each confirmed fill
        </div>
      </div>
    </div>
  )
}

// Netlify Function: metrics (Solana Tracker only)
// Returns lightweight metrics for a pair of mints: holders count per side and 24h volume per pool.
// Only uses Solana Tracker API (no Helius / RPC scanning).

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

const SOLANA_TRACKER_API_KEY = process.env.SOLANA_TRACKER_API_KEY
const SOLANA_TRACKER_BASE_URL = process.env.SOLANA_TRACKER_BASE_URL || 'https://pro-api.solanatracker.io'
const INITIAL_BUY_SOL_PER_SIDE = parseFloat(process.env.INITIAL_BUY_SOL_PER_SIDE || '0.02')

async function fetchTrackerHolders(tokenStr) {
  try {
    if (!SOLANA_TRACKER_API_KEY || !SOLANA_TRACKER_BASE_URL || !tokenStr) return null
    const url = `${SOLANA_TRACKER_BASE_URL}/tokens/${tokenStr}`
    const res = await fetch(url, { headers: { 'x-api-key': SOLANA_TRACKER_API_KEY } })
    if (!res.ok) return null
    const json = await res.json()
    const holders = Number(json?.holders ?? json?.token?.holders ?? 0)
    return isFinite(holders) && holders >= 0 ? holders : null
  } catch (_) {
    return null
  }
}

async function countHolders(mintStr) {
  try {
    if (!mintStr) return 0
    // Tracker holders only
    const trackerH = await fetchTrackerHolders(mintStr)
    if (trackerH != null) return trackerH
    return 0
  } catch (e) {
    console.error('countHolders error for', mintStr, e?.message || e)
    return 0
  }
}

async function fetchTrackerStatsByTokenAndPool(tokenStr, poolStr) {
  try {
    if (!SOLANA_TRACKER_API_KEY || !SOLANA_TRACKER_BASE_URL || !tokenStr) return null
    // Prefer direct stats endpoint if pool provided
    if (poolStr) {
      const statsUrl = `${SOLANA_TRACKER_BASE_URL}/stats/${tokenStr}/${poolStr}`
      const res = await fetch(statsUrl, { headers: { 'x-api-key': SOLANA_TRACKER_API_KEY } })
      if (res.ok) return await res.json()
    }
    // Fallback: fetch token info and find matching pool
    const url = `${SOLANA_TRACKER_BASE_URL}/tokens/${tokenStr}`
    const res = await fetch(url, { headers: { 'x-api-key': SOLANA_TRACKER_API_KEY } })
    if (!res.ok) return null
    const json = await res.json()
    return json
  } catch (_) {
    return null
  }
}

async function volumeForPool(poolStr, tokenStr) {
  try {
    if (!poolStr) return 0
    // Solana Tracker (24h volume)
    const tracker = await fetchTrackerStatsByTokenAndPool(tokenStr, poolStr)
    if (tracker) {
      // Try stats shape first
      const vol24 = Number(tracker?.txns?.volume24h ?? tracker?.volume24h)
      if (isFinite(vol24) && vol24 >= 0) return vol24
      // Try token shape with pools array
      const pools = tracker?.pools || []
      const found = pools.find(p => p.poolId === poolStr)
      const vol = Number(found?.txns?.volume24h ?? found?.txns?.volume)
      if (isFinite(vol) && vol >= 0) return vol
    }
    return 0
  } catch (e) {
    console.error('volumeForPool error for', poolStr, e?.message || e)
    return 0
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  try {
    const { lessMint, moreMint, lessPool, morePool, createdAt } = JSON.parse(event.body || '{}')
    if (!lessMint && !moreMint && !lessPool && !morePool) {
      return { statusCode: 400, body: JSON.stringify({ error: 'at least one of less/more mint or pool is required' }) }
    }
    const derivedLessPool = lessPool || null
    const derivedMorePool = morePool || null
    const [lessH, moreH, lessVol, moreVol] = await Promise.all([
      countHolders(lessMint),
      countHolders(moreMint),
      volumeForPool(derivedLessPool, lessMint),
      volumeForPool(derivedMorePool, moreMint),
    ])
    // Fallback for brand-new pools: assume dev buy per side if no data yet
    const ageMs = createdAt ? (Date.now() - Date.parse(createdAt)) : Number.POSITIVE_INFINITY
    const isVeryNew = isFinite(ageMs) && ageMs >= 0 && ageMs < 10 * 60 * 1000 // 10 minutes
    let adjLessVol = lessVol
    let adjMoreVol = moreVol
    if (isVeryNew) {
      if (!adjLessVol || adjLessVol === 0) adjLessVol = INITIAL_BUY_SOL_PER_SIDE
      if (!adjMoreVol || adjMoreVol === 0) adjMoreVol = INITIAL_BUY_SOL_PER_SIDE
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        less: { holders: lessH, volume: adjLessVol },
        more: { holders: moreH, volume: adjMoreVol },
        totals: { volume: adjLessVol + adjMoreVol },
      }),
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}

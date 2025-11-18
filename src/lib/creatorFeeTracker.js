const stripTrailingSlash = (url = '') => url.replace(/\/$/, '')

export async function triggerCreatorFeeTracker({ pickId, txHash, marketAddress }) {
  const baseUrl = stripTrailingSlash(import.meta.env.VITE_SUPABASE_URL || '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  if (!pickId || !txHash || !marketAddress) return
  if (!baseUrl || !anonKey) {
    console.warn('[creatorFeeTracker] Missing Supabase env, skipping edge call')
    return
  }

  const payload = {
    pickId,
    txHash: txHash.toLowerCase(),
    marketAddress,
  }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/creator-fee-tracker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch (_) {}
    if (!res.ok) {
      const errorMsg = (body && body.error) ? String(body.error) : text || 'Unknown edge error'
      const isExpected =
        (res.status === 404 && /No Bought events/i.test(errorMsg)) ||
        (res.status === 409 && /Receipt not yet available/i.test(errorMsg))
      if (isExpected) {
        console.info('[creatorFeeTracker] edge function pending', { status: res.status, error: errorMsg })
        return
      }
      throw new Error(`creator-fee-tracker failed: ${res.status} ${errorMsg}`)
    }
  } catch (err) {
    console.warn('[creatorFeeTracker] Request failed', err)
    throw err
  }
}

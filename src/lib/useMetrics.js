import { useEffect, useState } from 'react'
import { apiUrl } from './api.js'

export function useMetrics({ lessMint, moreMint, lessPool, morePool, createdAt, refreshMs = 15000 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let timer
    let aborted = false

    const fetchMetrics = async () => {
      if (!lessMint && !moreMint) return
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(apiUrl('/metrics'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessMint, moreMint, lessPool, morePool, createdAt }),
        })
        const json = await res.json().catch(() => ({}))
        if (!aborted) setData(json)
      } catch (e) {
        if (!aborted) setError(e)
      } finally {
        if (!aborted) setLoading(false)
      }
    }

    fetchMetrics()
    if (refreshMs > 0) {
      timer = setInterval(fetchMetrics, refreshMs)
    }
    return () => { aborted = true; if (timer) clearInterval(timer) }
  }, [lessMint, moreMint, refreshMs])

  return { data, loading, error }
}

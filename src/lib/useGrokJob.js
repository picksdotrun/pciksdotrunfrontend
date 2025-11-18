import { useCallback, useEffect, useRef, useState } from 'react'

const START_FN = import.meta.env.VITE_GROK_START_FUNCTION_PATH || '/.netlify/functions/grok_start'
const RESULT_FN = import.meta.env.VITE_GROK_RESULT_FUNCTION_PATH || '/.netlify/functions/grok_result'

export default function useGrokJob() {
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState('idle') // idle|starting|running|done|error
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false; if (timer.current) clearTimeout(timer.current) }, [])

  const poll = useCallback(async (id, delayMs = 600) => {
    if (!alive.current) return
    try {
      const url = `${RESULT_FN}?id=${encodeURIComponent(id)}`
      const r = await fetch(url)
      if (r.status === 404) {
        // Not ready yet
        timer.current = setTimeout(() => poll(id, Math.min(delayMs * 1.5, 3000)), delayMs)
        return
      }
      const j = await r.json()
      if (j.status === 'pending' || j.status === 'running') {
        setStatus(j.status)
        timer.current = setTimeout(() => poll(id, Math.min(delayMs * 1.5, 3000)), delayMs)
      } else if (j.status === 'done') {
        setResult(j)
        setStatus('done')
      } else if (j.status === 'error') {
        setError(j)
        setStatus('error')
      } else {
        setResult(j)
        setStatus('done')
      }
    } catch (e) {
      setError(e)
      setStatus('error')
    }
  }, [])

  const start = useCallback(async (payload) => {
    setError(null)
    setResult(null)
    setStatus('starting')
    setJobId(null)
    const res = await fetch(START_FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const text = await res.text()
    if (!res.ok && res.status !== 202) throw new Error(text || 'Failed to start job')
    let json
    try { json = JSON.parse(text) } catch { json = {} }
    const id = json?.jobId
    if (!id) throw new Error('No jobId returned')
    setJobId(id)
    setStatus('running')
    // Trigger background worker directly from client (bypasses server scheduling issues)
    async function triggerWorker() {
      const body = JSON.stringify({ jobId: id, payload })
      // Try canonical route first (maps -background automatically)
      let resp = await fetch('/.netlify/functions/grok_worker', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nf-background': 'true' }, body,
      }).catch(() => null)
      if (!resp || resp.status === 404) {
        // Some setups require hitting the -background path explicitly
        await fetch('/.netlify/functions/grok_worker-background', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }).catch(()=>{})
      }
    }
    triggerWorker()
    poll(id)
    return id
  }, [poll])

  const reset = useCallback(() => {
    setJobId(null)
    setStatus('idle')
    setResult(null)
    setError(null)
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { jobId, status, result, error, start, reset }
}

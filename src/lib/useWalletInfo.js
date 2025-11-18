import { useEffect, useState } from 'react'
import { apiUrl } from './api.js'

export function useWalletInfo({ refreshMs = 15000 } = {}) {
  const [address, setAddress] = useState(null)
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let timer
    let aborted = false
    const fetchInfo = async () => {
      setLoading(true)
      setError(null)
      try {
        // Allow overrides for convenience without server env:
        // 1) URL ?wallet=ADDRESS
        // 2) localStorage 'launchWalletOverride'
        // 3) Vite env VITE_LAUNCH_WALLET
        const urlParams = new URLSearchParams(window.location.search)
        const qAddr = urlParams.get('wallet')
        if (qAddr) localStorage.setItem('launchWalletOverride', qAddr)
        const lsAddr = localStorage.getItem('launchWalletOverride')
        const envAddr = import.meta.env.VITE_LAUNCH_WALLET
        const addr = qAddr || lsAddr || envAddr || null
        const endpoint = addr
          ? apiUrl(`/wallet?address=${encodeURIComponent(addr)}`) 
          : apiUrl('/wallet')
        const res = await fetch(endpoint)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || 'Failed to fetch wallet info')
        if (!aborted) {
          setAddress(json.publicKey || null)
          setBalance(typeof json.balanceSol === 'number' ? json.balanceSol : null)
        }
      } catch (e) {
        if (!aborted) setError(e)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    fetchInfo()
    if (refreshMs > 0) timer = setInterval(fetchInfo, refreshMs)
    return () => { aborted = true; if (timer) clearInterval(timer) }
  }, [refreshMs])

  return { address, balance, loading, error }
}

import { useEffect } from 'react'
import { storeXOauthCallbackPayload } from '../lib/xAuth'

export default function XCallback() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const payload = {
      code: url.searchParams.get('code') || null,
      state: url.searchParams.get('state') || null,
      error: url.searchParams.get('error') || null,
      error_description: url.searchParams.get('error_description') || null,
    }
    storeXOauthCallbackPayload(payload)
    window.location.replace('/claimrewards')
  }, [])

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-3xl border border-card-border/80 bg-surface-muted/50 px-6 py-8 text-center space-y-4 shadow-[0_35px_120px_-60px_rgba(0,0,0,0.8)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-black border border-card-border/70">
          <span className="text-2xl font-semibold text-white">X</span>
        </div>
        <h1 className="text-xl font-semibold text-white">Redirecting…</h1>
        <p className="text-sm text-gray-300">Finishing your X authorization and returning to Picks.run.</p>
      </div>
    </div>
  )
}

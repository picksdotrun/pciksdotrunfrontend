import React from 'react'

const steps = [
  { until: 0.33, label: 'Uploading image to IPFS…' },
  { until: 0.50, label: 'Preparing OVER token for launch…' },
  { until: 0.66, label: 'Launching OVER token…' },
  { until: 0.83, label: 'Preparing UNDER token…' },
  { until: 0.99, label: 'Launching UNDER token…' },
]

export default function LaunchProgress({ percent = 0, message, onCancel }) {
  const pct = Math.max(0, Math.min(100, Math.floor(percent)))
  const autoLabel = steps.find(s => pct/100 <= s.until)?.label || 'Finalizing…'
  const label = message || autoLabel

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card-bg border border-card-border rounded-xl p-6 shadow-xl shadow-black/40">
        <div className="text-white font-bold text-lg mb-2">Launching prediction…</div>
        <div className="text-gray-secondary text-sm mb-4">{label}</div>
        <div className="w-full h-2 bg-card-border rounded overflow-hidden">
          <div className="h-full bg-green-bright transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-right text-xs text-gray-secondary">{pct}%</div>
        {onCancel && (
          <div className="mt-4 text-right">
            <button onClick={onCancel} className="text-xs text-gray-secondary hover:text-white transition-colors">Hide</button>
          </div>
        )}
      </div>
    </div>
  )
}


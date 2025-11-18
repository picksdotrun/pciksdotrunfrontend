export default function ParamCard({ title, short, children }) {
  return (
    <details className="group rounded-lg border border-card-border bg-gray-50 open:bg-gray-100">
      <summary className="list-none cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-3">
        <div>
        <div className="text-white font-medium">{title}</div>
          <div className="text-xs text-gray-secondary">{short}</div>
        </div>
        <span className="text-gray-secondary text-xs">{/* chevron */}
          <svg className="w-4 h-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>
      <div className="px-3 pb-3 text-sm text-gray-700">
        {children}
      </div>
    </details>
  )
}

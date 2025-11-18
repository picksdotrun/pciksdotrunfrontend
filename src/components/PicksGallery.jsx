import { Link } from 'react-router-dom'

export default function PicksGallery({ picks, emptyLabel = 'No picks yet.' }) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return <div className="text-sm text-gray-400">{emptyLabel}</div>
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
      {picks.map((pick) => (
        <Link
          key={pick.id}
          to={`/pick/${pick.id}`}
          className="relative block aspect-[4/5] rounded-2xl overflow-hidden border border-card-border/60 bg-surface-muted/40 hover:border-green-bright/60 transition-colors"
        >
          {pick?.image ? (
            <img src={pick.image} alt={pick.name || 'Pick preview'} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-[10px] uppercase tracking-[0.3em] text-gray-500">
              Preview
            </div>
          )}
          <div className="absolute bottom-2 left-2 right-2 text-[10px] font-semibold text-white drop-shadow-md truncate">
            {pick?.name || 'Untitled pick'}
          </div>
        </Link>
      ))}
    </div>
  )
}

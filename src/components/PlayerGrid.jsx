import PlayerCard from './PlayerCard'

const PlayerGrid = ({ onPlayerSelection, players = [], onCardClick, activePlayerId, variant = 'default' }) => {
  if (!players || players.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 border border-dashed border-card-border rounded-xl text-center">
        <div className="text-gray-secondary mb-3">No picks yet</div>
        <div className="text-gray-200">Use the Create prediction button to add your first pick.</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {players.map((player) => (
        <PlayerCard
          key={player.id}
          player={player}
          onSelection={onPlayerSelection}
          onClick={onCardClick}
          isActive={activePlayerId === player.id}
          variant={variant}
        />
      ))}
    </div>
  )
}

export default PlayerGrid

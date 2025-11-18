// Utilities to compute streaks and basic stats from a list of picks.
// Assumes each pick has a `status` field: 'won' | 'lost' | 'open' (others ignored)

export function computeStreaks(picks = [], { statusField = 'status' } = {}) {
  const statuses = (Array.isArray(picks) ? picks : [])
    .map((p) => String(p?.[statusField] || '').toLowerCase())

  let currentStreak = 0
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i] === 'won') currentStreak++
    else break
  }

  let bestStreak = 0
  let run = 0
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i] === 'won') {
      run++
      if (run > bestStreak) bestStreak = run
    } else if (statuses[i] === 'lost') {
      run = 0
    } else {
      // ignore 'open' and unknown for bestStreak computation
    }
  }

  return { currentStreak, bestStreak }
}

export function computeWinRate(picks = [], { statusField = 'status' } = {}) {
  let won = 0
  let decided = 0
  for (const p of picks || []) {
    const s = String(p?.[statusField] || '').toLowerCase()
    if (s === 'won' || s === 'lost') {
      decided++
      if (s === 'won') won++
    }
  }
  return decided ? (won / decided) * 100 : 0
}


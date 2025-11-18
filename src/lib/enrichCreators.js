import { supabase } from './supabase'

const CREATOR_FIELDS = 'id, wallet, username, display_name, avatar_url'

export async function enrichPicksWithCreators(rows) {
  const picks = Array.isArray(rows) ? rows : []
  const creatorIds = Array.from(
    new Set(
      picks
        .map((row) => row?.creator_id)
        .filter((value) => typeof value === 'number' || (typeof value === 'string' && value)),
    ),
  )
  if (!creatorIds.length) return picks

  try {
    const { data, error } = await supabase
      .from('users')
      .select(CREATOR_FIELDS)
      .in('id', creatorIds)
    if (error) throw error
    const profileMap = new Map((data || []).map((profile) => [profile.id, profile]))
    return picks.map((pick) => {
      const profile = profileMap.get(pick?.creator_id)
      if (!profile) return pick
      return {
        ...pick,
        creator: profile,
        creator_wallet: pick?.creator_wallet || profile.wallet || null,
        creator_display_name: pick?.creator_display_name || profile.display_name || profile.username || null,
        creator_avatar_url: pick?.creator_avatar_url || profile.avatar_url || null,
      }
    })
  } catch (err) {
    console.error('[enrichPicksWithCreators] failed to load creators', err)
    return picks
  }
}

export async function enrichSinglePick(row) {
  const enriched = await enrichPicksWithCreators([row])
  return enriched[0] || row
}

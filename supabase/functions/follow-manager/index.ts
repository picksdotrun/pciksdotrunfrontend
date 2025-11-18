import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const shortAddress = (value?: string | null) => (value ? `${value.slice(0, 4)}…${value.slice(-4)}` : 'Picks user')

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing')

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

    const body = await req.json()
    const { action, targetUserId, followerUserId } = body || {}

    if (!action || !targetUserId || !followerUserId) {
      throw new Error('Missing action, targetUserId, or followerUserId')
    }
    if (targetUserId === followerUserId) {
      throw new Error('Cannot follow yourself')
    }

    const fetchUser = async (id: string) => {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, display_name, wallet')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    }

    if (action === 'unfollow') {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', followerUserId)
        .eq('following_id', targetUserId)
      if (error) throw error
    } else if (action === 'follow') {
      const follower = await fetchUser(followerUserId)
      const following = await fetchUser(targetUserId)
      if (!follower || !following) throw new Error('User not found')
      const followerName = follower.display_name || follower.username || shortAddress(follower.wallet)
      const followingName = following.display_name || following.username || shortAddress(following.wallet)
      const { error } = await supabase.from('follows').insert({
        follower_id: followerUserId,
        follower_screen_name: followerName || 'Picks user',
        following_id: targetUserId,
        following_screen_name: followingName || 'Picks user',
      })
      if (error) {
        if ((error as Record<string, unknown>).code === '23505') throw new Error('Already following this user')
        throw error
      }
    } else {
      throw new Error('Invalid action')
    }

    const [{ count: followerCount, data: followerRows, error: followerRowsError }, { count: followingCount, data: followingRows, error: followingRowsError }] = await Promise.all([
      supabase
        .from('follows')
        .select('follower_id, follower_screen_name', { count: 'exact' })
        .eq('following_id', targetUserId),
      supabase
        .from('follows')
        .select('following_id, following_screen_name', { count: 'exact' })
        .eq('follower_id', followerUserId),
    ])

    if (followerRowsError) throw followerRowsError
    if (followingRowsError) throw followingRowsError

    const followersList = (followerRows || []).map((row) => ({ id: row.follower_id, screen_name: row.follower_screen_name }))
    const followingList = (followingRows || []).map((row) => ({ id: row.following_id, screen_name: row.following_screen_name }))

    await Promise.all([
      supabase
        .from('users')
        .update({ followers_count: followerCount || 0, followers: followersList })
        .eq('id', targetUserId),
      supabase
        .from('users')
        .update({ following_count: followingCount || 0, following: followingList })
        .eq('id', followerUserId),
    ])

    return new Response(
      JSON.stringify({
        success: true,
        action,
        targetFollowerCount: followerCount || 0,
        userFollowingCount: followingCount || 0,
        followers: followersList,
        following: followingList,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('[follow-manager] error', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message || 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

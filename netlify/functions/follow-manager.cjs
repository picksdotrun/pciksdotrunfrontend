const { createClient } = require('@supabase/supabase-js')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: 'ok',
    }
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials missing')
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const payload = JSON.parse(event.body || '{}')
    const { action, targetUserId, followerUserId } = payload || {}
    if (!targetUserId || !followerUserId) {
      throw new Error('targetUserId and followerUserId are required')
    }
    if (targetUserId === followerUserId) {
      throw new Error('You cannot follow yourself')
    }

    const fetchUser = async (id) => {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, display_name, wallet')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data || null
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
      if (!follower || !following) throw new Error('Users not found')
      const followerName = follower.display_name || follower.username || shortAddress(follower.wallet)
      const followingName = following.display_name || following.username || shortAddress(following.wallet)
      const { error } = await supabase.from('follows').insert({
        follower_id: followerUserId,
        follower_screen_name: followerName || 'Picks user',
        following_id: targetUserId,
        following_screen_name: followingName || 'Picks user',
      })
      if (error) {
        if (error.code === '23505') throw new Error('Already following this user')
        throw error
      }
    } else {
      throw new Error('Invalid action')
    }

    const followCounts = await Promise.all([
      supabase
        .from('follows')
        .select('*', { head: true, count: 'exact' })
        .eq('following_id', targetUserId),
      supabase
        .from('follows')
        .select('*', { head: true, count: 'exact' })
        .eq('follower_id', followerUserId),
    ])
    const followerCount = followCounts[0].count || 0
    const followingCount = followCounts[1].count || 0

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        action,
        targetFollowerCount: followerCount,
        userFollowingCount: followingCount,
      }),
    }
  } catch (error) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    }
  }
}

function shortAddress(value) {
  return value ? `${value.slice(0, 4)}…${value.slice(-4)}` : 'Picks user'
}

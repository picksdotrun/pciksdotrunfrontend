import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/useProfile'

/**
 * Simplified follow button that uses only Supabase reads/writes.
 * Keeps the hook order constant (fixed state hooks + effect) to avoid
 * the React 310 invariant we were seeing when Netlify calls failed mid-render.
 */
export default function FollowButton({ targetUserId, className = '' }) {
  const { profile, authenticated, login } = useProfile()
  const currentUserId = profile?.id
  const [status, setStatus] = useState({ loading: true, following: false })
  const disabled = !targetUserId || !currentUserId || targetUserId === currentUserId

  useEffect(() => {
    let mounted = true
    const loadState = async () => {
      if (disabled) {
        setStatus({ loading: false, following: false })
        return
      }
      try {
        const { data, error } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', currentUserId)
          .eq('following_id', targetUserId)
          .maybeSingle()
        if (error) throw error
        if (mounted) setStatus({ loading: false, following: Boolean(data) })
      } catch (err) {
        console.error('[FollowButton] load failed', err)
        if (mounted) setStatus({ loading: false, following: false })
      }
    }
    loadState()
    return () => { mounted = false }
  }, [currentUserId, targetUserId, disabled])

  const handleClick = async () => {
    if (disabled) return
    if (!authenticated) {
      try { await login?.() } catch (err) { console.error('[FollowButton] login failed', err) }
      return
    }
    const isFollowing = status.following
    const nextAction = isFollowing ? 'unfollow' : 'follow'
    setStatus((prev) => ({ ...prev, loading: true }))
    try {
      const { error } = await supabase.functions.invoke('follow-manager', {
        body: {
          action: nextAction,
          targetUserId,
          followerUserId: currentUserId,
        },
      })
      if (error) throw error
      setStatus({ loading: false, following: nextAction === 'follow' })
    } catch (err) {
      console.error('[FollowButton] toggle failed', err)
      setStatus({ loading: false, following: isFollowing })
    }
  }

  if (!targetUserId || targetUserId === currentUserId) return null

  const label = status.loading ? '…' : (status.following ? 'Following' : 'Follow')

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status.loading}
      className={`inline-flex items-center justify-center rounded-full border px-6 py-2.5 text-sm font-semibold min-w-[140px] transition-colors disabled:opacity-60 ${
        status.following
          ? 'border-green-bright text-green-bright hover:bg-green-bright/10'
          : 'border-card-border text-gray-200 hover:border-green-bright/60'
      } ${className}`}
    >
      {label}
    </button>
  )
}

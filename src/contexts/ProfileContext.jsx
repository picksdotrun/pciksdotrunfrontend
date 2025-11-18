import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useCreateWallet as useCreateExtendedWallet } from '@privy-io/react-auth/extended-chains'
import { supabase } from '../lib/supabase'
import { useUserWallet } from '../lib/useUserWallet'

const BUCKET_ID = 'profile-photos'
const BUCKET_FOLDER = 'profile-photos'
const MAX_BIO_LENGTH = 280

const ProfileContext = createContext(null)

function sanitizeFileName(name = '') {
  const base = name.split('/').pop() || `file-${Date.now()}`
  return base.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function clampText(value, maxLength) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function normaliseUpdates(walletAddress, updates = {}) {
  const payload = {}
  if (walletAddress) payload.wallet = walletAddress
  if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
    payload.username = clampText(updates.username, 48)
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'display_name')) {
    payload.display_name = clampText(updates.display_name, 64)
    if (!payload.username && payload.display_name) {
      payload.username = payload.display_name
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'bio')) {
    payload.bio = clampText(updates.bio, MAX_BIO_LENGTH)
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'avatar_url')) {
    const raw = typeof updates.avatar_url === 'string' ? updates.avatar_url.trim() : ''
    payload.avatar_url = raw || null
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'avatar_path')) {
    const raw = typeof updates.avatar_path === 'string' ? updates.avatar_path.trim() : ''
    payload.avatar_path = raw || null
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'avatar_bucket')) {
    const raw = typeof updates.avatar_bucket === 'string' ? updates.avatar_bucket.trim() : ''
    payload.avatar_bucket = raw || null
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'followers')) {
    payload.followers = Array.isArray(updates.followers) ? updates.followers : []
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'followers_count')) {
    const count = Number(updates.followers_count)
    payload.followers_count = Number.isFinite(count) ? count : 0
  }
  return payload
}

export function ProfileProvider({ children }) {
  const { publicKey: mmWalletAddress, connect, disconnect } = useUserWallet()
  const { ready: privyReady, authenticated: privyAuthed, user: privyUser, login: privyLogin, logout: privyLogout } = usePrivy()
  const { wallets: privyWallets } = useWallets()
  const { createWallet } = useCreateExtendedWallet()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [initialised, setInitialised] = useState(false)
  const subscriptionRef = useRef(null)
  const walletCreationAttempted = useRef(false)

  const privyEvmAddress = useMemo(() => {
    const evm = (privyWallets || []).find((w) => w?.type === 'ethereum')
    return evm?.address || null
  }, [privyWallets])

  const privyUserId = privyUser?.id || null
  const usingPrivy = !!privyAuthed && !!privyEvmAddress
  const walletAddress = usingPrivy ? privyEvmAddress : (mmWalletAddress || null)
  const walletAddressLower = walletAddress ? walletAddress.toLowerCase() : null
  const authenticated = usingPrivy ? !!privyUserId : !!walletAddressLower

  const requestEmbeddedWallet = useCallback(async () => {
    if (!privyReady || !privyAuthed) throw new Error('Privy session required')
    const existing = (privyWallets || []).find((w) => w?.walletClientType === 'privy' && w?.type === 'ethereum')
    if (existing?.address) return existing.address
    if (walletCreationAttempted.current) throw new Error('Wallet creation already in progress')
    walletCreationAttempted.current = true
    try {
      const created = await createWallet({ chainType: 'ethereum' })
      return created?.address || null
    } catch (err) {
      console.error('[ProfileProvider] Failed to create Privy wallet', err)
      throw err
    } finally {
      walletCreationAttempted.current = false
    }
  }, [privyReady, privyAuthed, privyWallets, createWallet])

  const syncPrivyUser = useCallback(async () => {
    if (!usingPrivy || !privyUserId) return null
    const identityPayload = {
      privy_user_id: privyUserId,
      auth_method: 'privy',
    }
    if (walletAddressLower) identityPayload.wallet = walletAddressLower
    try {
      let row = null
      const filters = []
      if (privyUserId) filters.push(`privy_user_id.eq.${privyUserId}`)
      if (walletAddressLower) filters.push(`wallet.eq.${walletAddressLower}`)
      if (filters.length) {
        const { data } = await supabase
          .from('users')
          .select('*')
          .or(filters.join(','))
          .maybeSingle()
        row = data || null
      }
      if (row) {
        const { data: updated, error: updateError } = await supabase
          .from('users')
          .update(identityPayload)
          .eq('id', row.id)
          .select('*')
          .maybeSingle()
        if (updateError) throw updateError
        row = updated
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('users')
          .insert(identityPayload)
          .select('*')
          .maybeSingle()
        if (insertError) throw insertError
        row = inserted
      }
      setProfile(row)
      return row
    } catch (err) {
      console.error('[ProfileProvider] Privy sync failed', err)
      return null
    }
  }, [usingPrivy, privyUserId, walletAddressLower])

  const fetchProfile = useCallback(async () => {
    if (!walletAddressLower && !privyUserId) {
      setProfile(null)
      setInitialised(true)
      return null
    }
    setLoading(true)
    setError(null)
    try {
      let row = null
      if (usingPrivy) {
        row = await syncPrivyUser()
      }
      if (!row) {
        let query = supabase.from('users').select('*').limit(1)
        if (privyUserId && walletAddressLower) {
          query = query.or(`privy_user_id.eq.${privyUserId},wallet.eq.${walletAddressLower}`)
        } else if (privyUserId) {
          query = query.eq('privy_user_id', privyUserId)
        } else if (walletAddressLower) {
          query = query.eq('wallet', walletAddressLower)
        }
        const { data, error: fetchError } = await query.maybeSingle()
        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError
        row = data || row
        if (!row && walletAddressLower) {
          const insertPayload = {
            wallet: walletAddressLower,
            privy_user_id: privyUserId,
            auth_method: usingPrivy ? 'privy' : 'walletconnect',
          }
          const { data: inserted, error: insertError } = await supabase
            .from('users')
            .insert(insertPayload)
            .select('*')
            .maybeSingle()
          if (insertError) throw insertError
          row = inserted
        }
      }
      setProfile(row)
      return row
    } catch (err) {
      setError(err)
      return null
    } finally {
      setLoading(false)
      setInitialised(true)
    }
  }, [walletAddressLower, privyUserId, usingPrivy, syncPrivyUser])

  useEffect(() => {
    if (!authenticated) {
      setProfile(null)
      setInitialised(false)
      if (subscriptionRef.current) {
        try { supabase.removeChannel(subscriptionRef.current) } catch {}
        subscriptionRef.current = null
      }
      return
    }
    fetchProfile()
  }, [authenticated, fetchProfile])

  useEffect(() => {
    if (!authenticated) return
    const filter = privyUserId ? `privy_user_id=eq.${privyUserId}` : (walletAddressLower ? `wallet=eq.${walletAddressLower}` : null)
    if (!filter) return
    const channel = supabase
      .channel(`users:${privyUserId || walletAddressLower}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users', filter },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setProfile(null)
            return
          }
          const row = payload.new || payload.record || null
          if (row) setProfile(row)
        },
      )
      .subscribe()
    subscriptionRef.current = channel
    return () => {
      try { supabase.removeChannel(channel) } catch {}
      if (subscriptionRef.current === channel) subscriptionRef.current = null
    }
  }, [authenticated, walletAddressLower, privyUserId])

  const updateProfile = useCallback(async (updates = {}) => {
    if (!authenticated || !walletAddressLower) throw new Error('Not authenticated')
    setLoading(true)
    setError(null)
    try {
      const payload = normaliseUpdates(walletAddressLower, updates)
      let query = supabase.from('users').update(payload).select('*').maybeSingle()
      if (profile?.id) {
        query = query.eq('id', profile.id)
      } else {
        query = query.eq('wallet', walletAddressLower)
      }
      const { data, error: updateError } = await query
      if (updateError) throw updateError
      setProfile(data)
      return data
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [authenticated, walletAddressLower, profile?.id])

  const uploadAvatarFile = useCallback(async (file, options = {}) => {
    const { persist = true, field = 'avatar_url' } = options || {}
    if (!authenticated || !walletAddressLower) throw new Error('Not authenticated')
    if (typeof File === 'undefined' || !(file instanceof File)) throw new Error('Invalid file')
    if (!/^image\//.test(file.type)) throw new Error('Only image files are allowed')
    if (file.size > 5 * 1024 * 1024) throw new Error('File too large (max 5MB)')

    setLoading(true)
    setError(null)
    try {
      const safeName = sanitizeFileName(file.name)
      const folderPath = `${BUCKET_FOLDER}/${walletAddressLower}`
      const objectPath = `${folderPath}/${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase
        .storage
        .from(BUCKET_ID)
        .upload(objectPath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type,
        })
      if (uploadError) throw uploadError

      const { data: publicData } = supabase.storage.from(BUCKET_ID).getPublicUrl(objectPath)
      const publicUrl = publicData?.publicUrl || null
      if (!publicUrl) throw new Error('Failed to generate public URL')

      if (persist && field) {
        const updatePayload = {
          [field]: publicUrl,
          avatar_path: objectPath,
          avatar_bucket: BUCKET_ID,
        }
        try {
          await updateProfile(updatePayload)
        } catch (_) {
          // ignore; caller will handle via updateProfile
        }
      }

      return { url: publicUrl, path: objectPath, bucket: BUCKET_ID }
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [authenticated, walletAddressLower, updateProfile])

  const login = useCallback(async () => {
    if (privyReady) {
      try { await privyLogin() } catch (err) { console.error('[ProfileProvider] Privy login failed', err) }
      return
    }
    await connect()
  }, [privyReady, privyLogin, connect])

  const logout = useCallback(async () => {
    try {
      localStorage.removeItem('AUTH_JWT_TOKEN')
      localStorage.removeItem('AUTH_JWT_EXPIRES_AT')
    } catch {}
    if (privyAuthed) {
      try { await privyLogout() } catch (err) { console.error('[ProfileProvider] Privy logout failed', err) }
    }
    await disconnect()
    setProfile(null)
    setInitialised(false)
  }, [privyAuthed, privyLogout, disconnect])

  const needsProfile = authenticated && initialised && !loading && !(profile?.username && profile?.avatar_url)

  const value = {
    ready: privyReady,
    authenticated,
    usingPrivy,
    walletAddress,
    profile,
    fetchProfile,
    updateProfile,
    uploadAvatarFile,
    login,
    logout,
    loading,
    error,
    privyUserId,
    initialised,
    needsProfile,
    requestEmbeddedWallet,
  }

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfileContext() {
  const ctx = useContext(ProfileContext)
  if (!ctx) {
    throw new Error('useProfile must be used within ProfileProvider')
  }
  return ctx
}

export { ProfileContext }

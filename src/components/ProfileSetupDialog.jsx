import { useEffect, useMemo, useRef, useState } from 'react'
import { useProfile } from '../lib/useProfile'

function shortAddress(addr) {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function ProfileSetupDialog({ open }) {
  const {
    authenticated,
    usingPrivy,
    walletAddress,
    profile,
    uploadAvatarFile,
    updateProfile,
    login,
    loading,
    requestEmbeddedWallet,
  } = useProfile()
  const [screenName, setScreenName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setScreenName(profile.username || profile.display_name || '')
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatar_url || '')
      setTouched(false)
    }
  }, [profile])

  const hasAvatar = !!avatarUrl
  const hasScreenName = screenName.trim().length >= 2
  const progress = useMemo(() => {
    if (hasScreenName) return 1
    if (hasAvatar) return 0.25
    return 0
  }, [hasAvatar, hasScreenName])

  const readyToSave = hasAvatar && hasScreenName && !saving && !loading

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setSaving(true)
    try {
      const result = await uploadAvatarFile(file, { persist: true, field: 'avatar_url' })
      setAvatarUrl(result?.url || '')
    } catch (err) {
      setError(err?.message || 'Unable to upload image. Try a different file.')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched(true)
    if (!readyToSave) {
      setError('Upload a profile image and choose a screen name to continue.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const trimmedBio = bio.trim()
      const trimmedName = screenName.trim()
      if (usingPrivy && requestEmbeddedWallet) {
        try {
          await requestEmbeddedWallet()
        } catch (walletErr) {
          console.error('[ProfileSetupDialog] Wallet creation failed', walletErr)
          setError(walletErr?.message || 'Unable to create embedded wallet')
          setSaving(false)
          return
        }
      }
      await updateProfile({
        username: trimmedName,
        display_name: trimmedName,
        bio: trimmedBio,
        avatar_url: avatarUrl || null,
        avatar_bucket: 'profile-photos',
      })
    } catch (err) {
      setError(err?.message || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  if (!authenticated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur px-4">
        <div className="max-w-md w-full bg-card-bg border border-card-border rounded-2xl p-6 text-center shadow-xl shadow-black/40">
          <h1 className="text-white text-2xl font-semibold mb-2">Connect your wallet</h1>
          <p className="text-gray-secondary text-sm mb-6">
            You need to connect a wallet before creating your Picks profile.
          </p>
          <button
            type="button"
            onClick={async () => {
              try { await login() } catch (err) { setError(err?.message || 'Unable to connect wallet') }
            }}
            className="inline-flex items-center justify-center bg-green-bright text-dark-bg font-semibold rounded-full px-6 py-2.5 text-base hover:opacity-90 transition-opacity"
          >
            Connect wallet
          </button>
          {error && <div className="mt-4 text-sm text-red-400">{error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-10">
      <div className="relative w-full max-w-5xl bg-card-bg/95 border border-card-border rounded-[2rem] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] overflow-hidden">
        <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[90vh]">
          <header className="px-10 pt-10 pb-6 text-center border-b border-card-border/60 bg-card-bg/60">
            <div className="flex flex-col items-center gap-3">
              <div className="text-white text-4xl font-extrabold tracking-tight">Set up your profile</div>
              <div className="text-gray-secondary text-sm">
                Connected wallet: <span className="text-gray-100 font-medium">{shortAddress(walletAddress)}</span>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-10 py-8">
            <section className="flex flex-col items-center gap-6 mb-10">
              <div className="w-32 h-32 rounded-full border-2 border-green-bright/60 bg-surface-muted flex items-center justify-center overflow-hidden shadow-inner shadow-black/40">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-gray-secondary text-sm">Upload image</span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleUploadClick}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-full bg-green-bright text-dark-bg font-semibold px-6 py-2.5 text-sm hover:opacity-90 transition disabled:opacity-60"
                >
                  {hasAvatar ? 'Replace image' : 'Upload image'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
              {!hasAvatar && touched && (
                <p className="text-xs text-red-400">Add a profile picture to continue.</p>
              )}
              <p className="text-xs text-gray-secondary">PNG, JPG, or GIF up to 5MB.</p>
            </section>

            <section className="max-w-2xl mx-auto w-full space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-secondary mb-2 text-center">Screen name *</label>
                <input
                  type="text"
                  value={screenName}
                  onChange={(event) => {
                    setScreenName(event.target.value.replace(/[^a-zA-Z0-9_ ]/g, ''))
                  }}
                  onBlur={() => setTouched(true)}
                  maxLength={32}
                  placeholder="Choose how people will see you"
                  className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-2xl px-5 py-3 text-lg outline-none focus:border-green-bright focus:ring-1 focus:ring-green-bright/40 transition"
                />
                {touched && !hasScreenName && (
                  <p className="mt-2 text-xs text-red-400 text-center">Screen name must be at least 2 characters.</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-secondary">Bio (optional)</label>
                  <span className="text-xs text-gray-secondary">{bio.length}/280</span>
                </div>
                <textarea
                  value={bio}
                  onChange={(event) => {
                    if (event.target.value.length <= 280) setBio(event.target.value)
                  }}
                  maxLength={280}
                  placeholder="Share your prediction style, favorite markets, or anything else."
                  className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-2xl px-5 py-3 outline-none focus:border-green-bright focus:ring-1 focus:ring-green-bright/40 transition min-h-[140px]"
                />
              </div>
            </section>
          </div>

          {error && (
            <div className="px-10 pb-3 text-center text-sm text-red-400">{error}</div>
          )}

          <footer className="px-10 pb-10 pt-4">
            <div className="mb-4 h-2 rounded-full bg-surface-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-bright via-green-bright/80 to-green-bright/60 transition-all duration-300 shadow-[0_0_12px_2px_rgba(57,255,20,0.45)]"
                style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
              />
            </div>
            <div className="text-center text-sm font-semibold text-cyan-300 drop-shadow-sm">
              {Math.round(Math.min(Math.max(progress, 0), 1) * 100)}% complete
            </div>
            <button
              type="submit"
              disabled={!readyToSave}
              className="w-full inline-flex items-center justify-center rounded-full bg-green-bright text-dark-bg font-semibold px-6 py-3 text-base hover:opacity-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Complete profile'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

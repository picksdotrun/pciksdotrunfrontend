import { useEffect, useState } from 'react'
import { useProfile } from '../lib/useProfile'

function EditProfileModal({ isOpen, onClose, profile, onSave, saving = false, error = null }) {
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [bannerUrl, setBannerUrl] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [twitter, setTwitter] = useState('')
  const [themeColor, setThemeColor] = useState('#39ff14')
  const [hideBalance, setHideBalance] = useState(false)
  const [showAchievements, setShowAchievements] = useState(true)
  const [localError, setLocalError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const { uploadAvatarFile } = useProfile()

  useEffect(() => {
    if (isOpen) {
      setDisplayName(profile?.display_name || '')
      setAvatarUrl(profile?.avatar_url || '')
      setBannerUrl(profile?.metadata?.banner_url || '')
      setBio(profile?.bio || '')
      setWebsite(profile?.metadata?.website || '')
      setTwitter(profile?.metadata?.twitter || '')
      setThemeColor(profile?.metadata?.theme_color || '#39ff14')
      setHideBalance(!!profile?.preferences?.hide_balance)
      setShowAchievements(Boolean(profile?.preferences?.show_achievements ?? true))
      setLocalError(null)
    }
  }, [isOpen, profile])

  if (!isOpen) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLocalError(null)
    try {
      const payload = {
        display_name: displayName.trim(),
        username: displayName.trim(),
        avatar_url: avatarUrl.trim() || null,
        bio: bio.trim(),
      }
      await onSave(payload)
      onClose()
    } catch (e) {
      setLocalError(e?.message || 'Failed to save profile')
    }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLocalError(null)
    setUploading(true)
    try {
      const result = await uploadAvatarFile(file, { persist: true, field: 'avatar_url' })
      setAvatarUrl(result?.url || '')
    } catch (err) {
      setLocalError(err?.message || 'Failed to upload avatar')
    } finally {
      setUploading(false)
    }
  }

  const handleBannerFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLocalError(null)
    setUploading(true)
    try {
      // upload but do not persist automatically
      const result = await uploadAvatarFile(file, { persist: false })
      setBannerUrl(result?.url || '')
    } catch (err) {
      setLocalError(err?.message || 'Failed to upload banner')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-card-bg border border-card-border w-full max-w-md rounded-xl shadow-2xl shadow-black/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Edit Profile</h3>
          <button onClick={onClose} className="text-gray-secondary hover:text-white transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-secondary mb-1">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-lg px-3 py-2 outline-none focus:border-purple-brand"
            />
          </div>
          <div className="grid gap-2">
            <label className="block text-sm text-gray-secondary">Avatar</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={uploading || saving}
                className="block w-full text-sm text-gray-secondary file:mr-3 file:py-2 file:px-3 file:rounded-full file:border file:border-card-border file:text-gray-100 file:bg-surface-muted hover:file:border-purple-brand"
              />
              {uploading && <span className="text-sm text-gray-secondary">Uploading…</span>}
            </div>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="or paste image URL (https://...)"
              className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-lg px-3 py-2 outline-none focus:border-purple-brand"
            />
            {avatarUrl && (
              <img src={avatarUrl} alt="Avatar preview" className="mt-1 h-16 w-16 rounded-full object-cover border border-card-border" />
            )}
          </div>

          <div className="grid gap-2">
            <label className="block text-sm text-gray-secondary">Banner</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={handleBannerFile}
                disabled={uploading || saving}
                className="block w-full text-sm text-gray-secondary file:mr-3 file:py-2 file:px-3 file:rounded-full file:border file:border-card-border file:text-gray-100 file:bg-surface-muted hover:file:border-purple-brand"
              />
            </div>
            <input
              type="url"
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              placeholder="or paste banner URL (https://...)"
              className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-lg px-3 py-2 outline-none focus:border-purple-brand"
            />
            {bannerUrl && (
              <img src={bannerUrl} alt="Banner preview" className="mt-1 h-20 w-full rounded-lg object-cover border border-card-border" />
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-secondary mb-1">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people about yourself"
              className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-lg px-3 py-2 outline-none focus:border-purple-brand min-h-[80px]"
              maxLength={280}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-secondary mb-1">Website</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-lg px-3 py-2 outline-none focus:border-purple-brand"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-secondary mb-1">Twitter/X</label>
              <input
                type="text"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="@handle or link"
                className="w-full bg-surface-muted text-gray-100 border border-card-border rounded-lg px-3 py-2 outline-none focus:border-purple-brand"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-sm text-gray-secondary mb-1">Theme color</label>
              <input
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="h-10 w-16 bg-surface-muted border border-card-border rounded"
                title="Pick your accent color"
              />
            </div>
            <div className="flex gap-4 mt-4 md:mt-0">
              <label className="inline-flex items-center gap-2 text-sm text-gray-secondary">
                <input type="checkbox" checked={hideBalance} onChange={(e) => setHideBalance(e.target.checked)} /> Hide SOL balance
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-secondary">
                <input type="checkbox" checked={showAchievements} onChange={(e) => setShowAchievements(e.target.checked)} /> Show achievements
              </label>
            </div>
          </div>

          {(localError || error) && (
            <div className="text-red-500 text-sm">{localError || error?.message || String(error)}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-card-border hover:border-green-bright text-gray-100 rounded-full px-4 py-2 text-sm transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`bg-green-bright text-dark-bg font-bold rounded-full px-4 py-2 text-sm hover:opacity-90 transition-opacity ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditProfileModal

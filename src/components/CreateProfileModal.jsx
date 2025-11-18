import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function CreateProfileModal({ isOpen, wallet, onClose, onCreated }) {
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const submit = async (e) => {
    e.preventDefault()
    if (!wallet) return
    if (!username.trim()) return
    setSaving(true)
    try {
      // Insert new user row if not exists (wallet unique constraint)
      const { data, error } = await supabase
        .from('users')
        .insert({ wallet, username: username.trim() })
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (onCreated) onCreated(data || null)
      onClose()
    } catch (err) {
      alert(err?.message || 'Failed to create profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card-bg border border-card-border rounded-2xl w-full max-w-md p-6 shadow-xl shadow-black/40">
        <div className="flex items-center gap-3 mb-4">
          <img src="/brand_logo.png" alt="Logo" className="h-10 object-contain" />
          <h2 className="text-white text-xl font-bold">Welcome to Picks!</h2>
        </div>
        <p className="text-gray-secondary text-sm mb-4">Set your username to create your profile.</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="text"
            className="w-full bg-surface-muted border border-card-border rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-purple-brand focus:ring-1 focus:ring-purple-brand/40"
            placeholder="Choose a username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={24}
            autoFocus
          />
          <button
            type="submit"
            disabled={!username.trim() || saving}
            className="inline-flex items-center justify-center bg-green-bright text-dark-bg font-extrabold rounded-full px-6 py-2.5 text-lg disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create Profile'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center border border-card-border text-gray-100 rounded-full px-6 py-2.5 text-sm hover:border-green-bright transition-colors"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  )
}

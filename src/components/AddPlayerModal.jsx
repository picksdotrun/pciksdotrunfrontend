import { useEffect, useMemo, useRef, useState } from 'react'
import PlayerCard from './PlayerCard'
import { supabase } from '../lib/supabase'
import { PICK_CATEGORY_OPTIONS, normalizePickCategory, DEFAULT_PICK_CATEGORY } from '../lib/pickCategories'

const STEP_INTRO = 1
const STEP_DETAILS = 2

const INITIAL_PLAYER = {
  name: '',
  line: '0.0',
  category: DEFAULT_PICK_CATEGORY,
  customCategory: DEFAULT_PICK_CATEGORY,
  description: '',
  image: null,
  yesLabel: '',
  yesValue: '',
  noLabel: '',
  noValue: '',
  yesProbability: 50,
}

const DURATION_OPTIONS = [
  { label: '1 Min', val: 60 },
  { label: '5 Min', val: 300 },
  { label: '10 Min', val: 600 },
  { label: '20 Min', val: 1200 },
  { label: 'One hour', val: 3600 },
  { label: 'One day', val: 86400 },
  { label: 'One week', val: 604800 },
]

const iconPencil = (
  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M11.3 3.3l5.4 5.4-8.4 8.4H2.9v-5.4l8.4-8.4z" />
    <path d="M14.4 6.4l-3.8-3.8" />
  </svg>
)

const iconCheck = (
  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 10l3 3 7-7" />
  </svg>
)

const iconUpload = (
  <svg className="w-10 h-10 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 16V4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" strokeLinecap="round" />
  </svg>
)

const AddPlayerModal = ({ isOpen, onClose, onAddPlayer }) => {
  const [playerData, setPlayerData] = useState(INITIAL_PLAYER)
  const [durationSec, setDurationSec] = useState(3600)
  const [imagePreview, setImagePreview] = useState(null)
  const [draftDescription, setDraftDescription] = useState('')
  const [step, setStep] = useState(STEP_INTRO)
  const [aiLoading, setAiLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [editableFields, setEditableFields] = useState({ name: false, description: false, outcomes: false, duration: false })
  const [customDateValue, setCustomDateValue] = useState('')
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false)
  const fileInputRef = useRef(null)
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const normalizeOutcome = (value, prefix) => {
    const base = typeof value === 'string' ? value.trim() : ''
    if (!base) return prefix === 'Yes' ? 'Yes outcome' : 'No outcome'
    const lowered = base.toLowerCase()
    const prefixLower = prefix.toLowerCase()
    if (lowered.startsWith(prefixLower)) {
      const remainder = base.slice(prefix.length).trim()
      return `${prefix} ${remainder}`.trim().replace(/\s+/g, ' ')
    }
    return `${prefix} ${base}`.trim().replace(/\s+/g, ' ')
  }

  const selectPresetDuration = (seconds) => {
    setDurationSec(seconds)
    setCustomDateValue('')
    setShowCustomDatePicker(false)
  }

  const updateDurationForDate = (isoDate) => {
    if (!isoDate) return
    const target = new Date(`${isoDate}T23:59:59`)
    const diff = Math.floor((target.getTime() - Date.now()) / 1000)
    if (!Number.isFinite(diff) || diff <= 0) {
      alert('Select a future date for expiration.')
      return
    }
    const safeDiff = Math.max(60, diff)
    setDurationSec(safeDiff)
  }

  const handleCustomDateToggle = () => {
    setShowCustomDatePicker((prev) => {
      const next = !prev
      if (!prev) {
        const initial = customDateValue || todayIso
        setCustomDateValue(initial)
        updateDurationForDate(initial)
      }
      return next
    })
  }

  const onCustomDateChange = (event) => {
    const value = event.target.value
    setCustomDateValue(value)
    updateDurationForDate(value)
  }

  useEffect(() => {
    if (step === STEP_INTRO) {
      if (aiLoading) {
        setProgress(75)
        return
      }
      let pct = 0
      if (imagePreview) pct = 25
      if (draftDescription.trim().length > 0) pct = 50
      setProgress(pct)
    } else {
      setProgress(aiLoading ? 75 : 100)
    }
  }, [step, aiLoading, imagePreview, draftDescription])

  useEffect(() => {
    if (!isOpen) {
      resetState()
    }
  }, [isOpen])

  const resetState = () => {
    setPlayerData(INITIAL_PLAYER)
    setDurationSec(3600)
    setImagePreview(null)
    setDraftDescription('')
    setStep(STEP_INTRO)
    setAiLoading(false)
    setProgress(0)
    setEditableFields({ name: false, description: false, outcomes: false, duration: false })
    setCustomDateValue('')
    setShowCustomDatePicker(false)
  }

  const handleImageChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB')
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result)
      setPlayerData((prev) => ({ ...prev, image: reader.result }))
    }
    reader.readAsDataURL(file)
  }

  const toggleEdit = (key) => {
    setEditableFields((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      if (key === 'outcomes' && prev[key]) {
        setPlayerData((current) => ({
          ...current,
          yesLabel: normalizeOutcome(current.yesLabel, 'Yes'),
          noLabel: normalizeOutcome(current.noLabel, 'No'),
        }))
      }
      return next
    })
  }

  const formattedCustomDate = customDateValue ? new Date(`${customDateValue}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  const handleNext = async () => {
    const trimmed = draftDescription.trim()
    if (!imagePreview) {
      alert('Upload an image for your prediction first.')
      return
    }
    if (!trimmed) {
      alert('Describe your prediction before continuing.')
      return
    }
    setAiLoading(true)
    setProgress(75)
    try {
      const { data, error } = await supabase.functions.invoke('prediction-creation', {
        body: { description: trimmed },
      })
      if (error) throw error
      const suggestion = (data && (data.suggestion || data.data)) || data || {}
      const safeName = (suggestion.name || playerData.name || 'New Prediction').toString().slice(0, 30)
      const safeLine = (suggestion.line || suggestion.number || playerData.line || '0.0').toString().slice(0, 15)
      const safeCategory = normalizePickCategory(suggestion.category || playerData.customCategory)
      const normalizedYes = normalizeOutcome(suggestion.yes_label || suggestion.yesLabel || playerData.yesLabel, 'Yes')
      const normalizedNo = normalizeOutcome(suggestion.no_label || suggestion.noLabel || playerData.noLabel, 'No')
      const rawYesProbability = Number(String(suggestion.yes_probability ?? suggestion.yesProbability ?? playerData.yesProbability ?? 50).replace(/[^0-9.]/g, ''))
      const safeYesProbability = Number.isFinite(rawYesProbability) ? Math.min(100, Math.max(0, rawYesProbability)) : 50
      setPlayerData((prev) => ({
        ...prev,
        name: safeName,
        line: safeLine,
        category: safeCategory,
        customCategory: safeCategory,
        description: suggestion.description || trimmed,
        yesLabel: normalizedYes,
        yesValue: suggestion.yes_value || suggestion.yesValue || prev.yesValue || '',
        noLabel: normalizedNo,
        noValue: suggestion.no_value || suggestion.noValue || prev.noValue || '',
        yesProbability: safeYesProbability,
      }))
      if (suggestion.duration_sec && Number.isFinite(Number(suggestion.duration_sec))) {
        setDurationSec(Number(suggestion.duration_sec))
        setCustomDateValue('')
        setShowCustomDatePicker(false)
      }
      setDraftDescription(suggestion.description || trimmed)
      setEditableFields({ name: false, description: false, outcomes: false, duration: false })
      setAiLoading(false)
      setStep(STEP_DETAILS)
    } catch (err) {
      console.error('[prediction-creation] failed', err)
      setAiLoading(false)
      setProgress(50)
      alert(err?.message || 'Unable to draft this prediction. Please try again.')
    }
  }

  const handleBack = () => {
    setStep(STEP_INTRO)
    setEditableFields({ name: false, description: false, outcomes: false, duration: false })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!playerData.name.trim()) {
      alert('Prediction name is required.')
      return
    }
    const effectiveLine = playerData.line?.toString().trim() || '0.0'
    const effectiveCategory = normalizePickCategory(playerData.customCategory)
    try {
      const normalizedYes = normalizeOutcome(playerData.yesLabel, 'Yes')
      const normalizedNo = normalizeOutcome(playerData.noLabel, 'No')
      const safeYesProbability = Number.isFinite(Number(playerData.yesProbability))
        ? Math.min(100, Math.max(0, Number(playerData.yesProbability)))
        : 50
      const sanitizedPlayer = {
        ...playerData,
        yesLabel: normalizedYes,
        noLabel: normalizedNo,
        yesProbability: safeYesProbability,
      }
      setPlayerData(sanitizedPlayer)
      const expiresAt = new Date(Date.now() + durationSec * 1000).toISOString()
      await onAddPlayer({
        ...sanitizedPlayer,
        line: effectiveLine,
        category: effectiveCategory,
        customCategory: effectiveCategory,
        description: sanitizedPlayer.description || draftDescription.trim(),
        durationSec,
        expiresAt,
      })
      resetState()
      onClose()
    } catch (err) {
      console.error('Failed to save pick:', err)
      alert(err?.message || 'Failed to save prediction. Please try again.')
    }
  }

  const previewCard = useMemo(() => {
    const now = Date.now()
    const expiresAt = new Date(now + Number(durationSec || 0) * 1000).toISOString()
    const previewPick = {
      id: 'preview',
      name: playerData.name || 'Name',
      line: playerData.line || '0.0',
      category: normalizePickCategory(playerData.customCategory),
      description: step === STEP_INTRO ? draftDescription : (playerData.description || ''),
      image: imagePreview || null,
      yes_label: playerData.yesLabel || '',
      yes_value: playerData.yesValue || '',
      no_label: playerData.noLabel || '',
      no_value: playerData.noValue || '',
      yes_probability: playerData.yesProbability ?? null,
      created_at: new Date(now - 10_000).toISOString(),
      duration_sec: Number(durationSec || 0),
      expires_at: expiresAt,
      status: 'open',
      preview_currency: 'BNB',
      evm_market_address: null,
    }
    return (
      <PlayerCard
        player={previewPick}
        onSelection={() => {}}
        onClick={() => {}}
        isActive={false}
      />
    )
  }, [playerData, imagePreview, durationSec, draftDescription, step])

  if (!isOpen) return null
  const showPreview = step === STEP_DETAILS

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4">
      <div className="relative bg-card-bg rounded-[2.5rem] w-full max-w-6xl min-h-[85vh] max-h-[92vh] border border-card-border shadow-[0_60px_180px_-40px_rgba(0,0,0,0.85)] overflow-hidden">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-secondary hover:text-white transition-colors z-20"
          aria-label="Close create modal"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {aiLoading && step === STEP_INTRO && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/70 backdrop-blur-sm">
            <div className="w-20 h-20 rounded-full border-4 border-cyan-300 border-t-transparent animate-spin" />
            <div className="text-white text-xl font-semibold tracking-[0.35em] uppercase">Creating Prediction</div>
          </div>
        )}

        <div className="h-full overflow-y-auto p-10">
          <h2 className="text-white text-2xl font-bold mb-6">Create New Prediction</h2>
          <div className={`grid gap-10 ${showPreview ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]' : ''}`}>
            <div className={showPreview ? '' : 'max-w-3xl mx-auto'}>
              {step === STEP_INTRO ? (
                <div className="space-y-6">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:gap-4">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="relative w-full lg:min-w-[420px] aspect-[4/3] flex flex-col items-center justify-center border-2 border-dashed border-card-border rounded-3xl bg-surface-muted/30 hover:border-green-bright transition-colors cursor-pointer overflow-hidden"
                    >
                      {imagePreview ? (
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center gap-3 px-6">
                          {iconUpload}
                          <p className="text-gray-secondary text-sm">Click or drop an image here to start your prediction.</p>
                        </div>
                      )}
                      {imagePreview && (
                        <button
                          type="button"
                          className="absolute top-4 right-4 text-xs bg-black/60 text-white px-3 py-1 rounded-full hover:bg-black/80"
                          onClick={(event) => {
                            event.stopPropagation()
                            setImagePreview(null)
                            setPlayerData((prev) => ({ ...prev, image: null }))
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {!imagePreview && (
                      <div className="mt-3 lg:mt-0 text-sm font-semibold text-red-400 lg:self-center">
                        Image upload required
                      </div>
                    )}
                  </div>

                  <textarea
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                  className="w-full bg-surface-muted border border-card-border rounded-3xl px-6 py-4 text-gray-100 text-base min-h-[180px] focus:outline-none focus:border-green-bright focus:ring-1 focus:ring-green-bright/40"
                  placeholder="Describe your prediction here and we will fill in the rest!"
                />

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-full border border-card-border text-gray-100 hover:border-green-bright transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={aiLoading || !imagePreview || !draftDescription.trim()}
                    className={`px-5 py-2.5 rounded-full font-semibold transition-colors ${aiLoading || !imagePreview || !draftDescription.trim()
                      ? 'bg-card-border text-gray-400 cursor-not-allowed'
                      : 'bg-green-bright text-dark-bg hover:opacity-90'
                    }`}
                  >
                    {aiLoading ? 'Generating…' : 'Next'}
                  </button>
                </div>

                <div className="mt-4">
                  <div className="h-2 rounded-full bg-surface-muted overflow-hidden w-full max-w-2xl">
                    <div className="h-full bg-green-bright transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-2 text-xs font-semibold text-gray-secondary">Progress {Math.round(progress)}%</div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-secondary text-sm">Name</label>
                    <button
                      type="button"
                      onClick={() => toggleEdit('name')}
                      className="flex items-center gap-1 text-xs text-gray-secondary hover:text-green-bright transition-colors"
                    >
                      {editableFields.name ? iconCheck : iconPencil}
                      {editableFields.name ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={playerData.name}
                    readOnly={!editableFields.name}
                    onChange={(event) => setPlayerData((prev) => ({ ...prev, name: event.target.value }))}
                    className={`w-full bg-surface-muted border border-card-border rounded-lg px-4 py-2 text-gray-100 focus:outline-none ${editableFields.name ? 'focus:border-green-bright' : 'opacity-70 cursor-not-allowed'}`}
                    maxLength={30}
                  />
                </div>

                <div>
                  <label className="text-gray-secondary text-sm mb-2 block">Category</label>
                  <select
                    value={playerData.customCategory}
                    onChange={(event) => setPlayerData((prev) => ({ ...prev, customCategory: event.target.value }))}
                    className="w-full bg-surface-muted border border-card-border rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-green-bright"
                  >
                    {PICK_CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-secondary text-sm">Description</label>
                    <button
                      type="button"
                      onClick={() => toggleEdit('description')}
                      className="flex items-center gap-1 text-xs text-gray-secondary hover:text-green-bright transition-colors"
                    >
                      {editableFields.description ? iconCheck : iconPencil}
                      {editableFields.description ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  <textarea
                    value={playerData.description}
                    readOnly={!editableFields.description}
                    onChange={(event) => setPlayerData((prev) => ({ ...prev, description: event.target.value }))}
                    className={`w-full bg-surface-muted border border-card-border rounded-lg px-4 py-3 text-gray-100 min-h-[100px] focus:outline-none ${editableFields.description ? 'focus:border-green-bright' : 'opacity-70 cursor-not-allowed'}`}
                    maxLength={200}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-secondary text-sm">Outcome descriptions</label>
                    <button
                      type="button"
                      onClick={() => toggleEdit('outcomes')}
                      className="flex items-center gap-1 text-xs text-gray-secondary hover:text-green-bright transition-colors"
                    >
                      {editableFields.outcomes ? iconCheck : iconPencil}
                      {editableFields.outcomes ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-card-border/70 bg-surface-muted/40 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.25em] text-green-300 mb-2">Yes</div>
                      <textarea
                        value={playerData.yesLabel}
                        readOnly={!editableFields.outcomes}
                        onChange={(event) => setPlayerData((prev) => ({ ...prev, yesLabel: event.target.value }))}
                        className={`w-full bg-transparent text-sm text-gray-100 placeholder-gray-500 leading-relaxed focus:outline-none border border-transparent rounded-md px-2 py-2 ${
                          editableFields.outcomes ? 'focus:border-green-bright' : 'opacity-70 cursor-not-allowed'
                        }`}
                        placeholder='Yes description (e.g., "Yes more than 3 touchdowns")'
                        maxLength={90}
                        rows={2}
                      />
                    </div>
                    <div className="rounded-2xl border border-card-border/70 bg-surface-muted/40 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.25em] text-rose-300 mb-2">No</div>
                      <textarea
                        value={playerData.noLabel}
                        readOnly={!editableFields.outcomes}
                        onChange={(event) => setPlayerData((prev) => ({ ...prev, noLabel: event.target.value }))}
                        className={`w-full bg-transparent text-sm text-gray-100 placeholder-gray-500 leading-relaxed focus:outline-none border border-transparent rounded-md px-2 py-2 ${
                          editableFields.outcomes ? 'focus:border-rose-400' : 'opacity-70 cursor-not-allowed'
                        }`}
                        placeholder='No description (e.g., "No 3 or fewer touchdowns")'
                        maxLength={90}
                        rows={2}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-gray-secondary text-sm mb-2">Yes probability (%)</label>
                  <input
                    type="number"
                    value={Math.round(playerData.yesProbability ?? 0)}
                    readOnly
                    className="w-full bg-surface-muted border border-card-border rounded-lg px-4 py-2 text-gray-100 opacity-70 cursor-not-allowed"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-gray-secondary text-sm">Time Expiration Interval</label>
                    <button
                      type="button"
                      onClick={() => toggleEdit('duration')}
                      className="flex items-center gap-1 text-xs text-gray-secondary hover:text-green-bright transition-colors"
                    >
                      {editableFields.duration ? iconCheck : iconPencil}
                      {editableFields.duration ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_OPTIONS.map((opt) => (
                      <button
                        type="button"
                        key={opt.val}
                        disabled={!editableFields.duration}
                        onClick={() => selectPresetDuration(opt.val)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${durationSec === opt.val && !customDateValue ? 'bg-green-bright text-dark-bg border-transparent' : 'bg-card-bg text-gray-secondary border-card-border hover:border-green-bright'} ${!editableFields.duration ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={!editableFields.duration}
                      onClick={handleCustomDateToggle}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${customDateValue ? 'bg-green-bright text-dark-bg border-transparent' : 'bg-card-bg text-gray-secondary border-card-border hover:border-green-bright'} ${!editableFields.duration ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      Select custom date
                    </button>
                  </div>
                  {showCustomDatePicker && editableFields.duration && (
                    <div className="mt-3 flex items-center gap-3">
                      <input
                        type="date"
                        value={customDateValue}
                        min={todayIso}
                        onChange={onCustomDateChange}
                        className="bg-surface-muted border border-card-border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-green-bright"
                      />
                      {customDateValue && (
                        <span className="text-xs text-gray-secondary">Expiration: {formattedCustomDate}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="px-4 py-2 rounded-full border border-card-border text-gray-100 hover:border-green-bright transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-full border border-card-border text-gray-100 hover:border-green-bright transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ml-auto px-5 py-2.5 rounded-full bg-green-bright text-dark-bg font-semibold hover:opacity-90"
                  >
                    Add Prediction
                  </button>
                </div>
              </form>
            )}
            </div>

            {showPreview && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-gray-secondary text-sm mb-2">Live Preview</h3>
                  <div className="rounded-3xl border border-card-border/70 overflow-hidden bg-surface-muted/30">
                    {previewCard}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="hidden"
        />
      </div>
    </div>
  )
}

export default AddPlayerModal

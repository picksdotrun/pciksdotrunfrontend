export const PICK_CATEGORY_OPTIONS = [
  'Sports',
  'Politics',
  'Culture',
  'Crypto',
  'Climate',
  'Economics',
  'Mentions',
  'Companies',
  'Financials',
  'Tech & Science',
  'Health',
  'World',
  'Prediction',
]

export const DEFAULT_PICK_CATEGORY = 'Sports'

export function normalizePickCategory(value) {
  if (!value) return 'Prediction'
  const cleaned = value.trim().toLowerCase()
  const match = PICK_CATEGORY_OPTIONS.find((opt) => opt.toLowerCase() === cleaned)
  return match || DEFAULT_PICK_CATEGORY
}

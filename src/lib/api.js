const DEFAULT_BASE = 'https://picksbackend-production.up.railway.app'
const rawBase = (import.meta.env && import.meta.env.VITE_API_BASE_URL != null)
  ? import.meta.env.VITE_API_BASE_URL
  : DEFAULT_BASE
const API_BASE = String(rawBase || '').replace(/\/$/, '') || ''

export function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE) return normalized
  return `${API_BASE}${normalized}`
}

export { API_BASE }

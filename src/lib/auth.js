import { apiUrl } from './api.js'
// Client-side auth helper that exchanges a wallet signature for a JWT issued by our Netlify functions.

const TOKEN_KEY = 'AUTH_JWT_TOKEN'
const TOKEN_EXP_KEY = 'AUTH_JWT_EXPIRES_AT'

function getStoredToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const expiresAt = Number(localStorage.getItem(TOKEN_EXP_KEY) || 0)
    if (token && expiresAt && Date.now() < expiresAt) return token
  } catch {}
  return null
}

function storeToken(token, ttlMs = 3 * 24 * 60 * 60 * 1000) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + ttlMs))
  } catch {}
}

export async function getAuthToken(address) {
  const cached = getStoredToken()
  if (cached) return cached
  if (!address) throw new Error('Missing wallet address')

  const nonceRes = await fetch(apiUrl(`/auth-nonce?address=${encodeURIComponent(address)}`))
  const nonceJson = await nonceRes.json().catch(() => ({}))
  if (!nonceRes.ok) throw new Error(nonceJson?.error || 'Failed to get nonce')

  const { nonce, issuedAt } = nonceJson || {}
  if (!nonce) throw new Error('Missing nonce')

  const messageLines = [
    'Picks Sign-in',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
  ]
  if (issuedAt) messageLines.push(`Issued At: ${issuedAt}`)
  const message = messageLines.join('\n')

  const ethereum = typeof window !== 'undefined' ? window.ethereum : null
  if (!ethereum) throw new Error('MetaMask not detected')

  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  })
  if (!signature) throw new Error('Signature rejected')

  const verifyRes = await fetch(apiUrl('/auth-verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce, signature, issuedAt }),
  })
  const verifyJson = await verifyRes.json().catch(() => ({}))
  if (!verifyRes.ok) throw new Error(verifyJson?.error || 'Auth failed')

  const token = verifyJson?.token
  if (!token) throw new Error('No token returned')

  storeToken(token)
  return token
}

export async function getAuthHeader(address) {
  const token = await getAuthToken(address)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

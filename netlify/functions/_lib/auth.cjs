// Shared auth utilities for Netlify functions (MetaMask JWT + optional Privy verification).

const crypto = require('crypto')
const { TextEncoder } = require('util')

function json(statusCode = 200, payload = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(payload ?? {}),
  }
}

function headerLookup(headers = {}, key) {
  if (!headers) return undefined
  if (headers[key] != null) return headers[key]
  const lowerKey = key.toLowerCase()
  for (const [k, value] of Object.entries(headers)) {
    if (k.toLowerCase() === lowerKey) return value
  }
  return undefined
}

function normalizeAddress(address) {
  if (typeof address !== 'string') return null
  const trimmed = address.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  return trimmed.toLowerCase()
}

async function verifyJwtToken(token) {
  const secret = process.env.AUTH_JWT_SECRET
  if (!secret) throw new Error('AUTH_JWT_SECRET not configured')
  const { jwtVerify } = await import('jose')
  const encoder = new TextEncoder()
  const verified = await jwtVerify(token, encoder.encode(secret))
  const payload = verified?.payload || {}
  const address = normalizeAddress(payload?.sub || payload?.address)
  if (!address) throw new Error('Invalid token payload')
  return { address, payload }
}

async function verifyPrivyToken(token) {
  const appId = process.env.PRIVY_APP_ID
  if (!token || !appId) throw new Error('Privy not configured')
  const { createRemoteJWKSet, jwtVerify } = await import('jose')
  const jwksUrl = `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`
  const JWKS = createRemoteJWKSet(new URL(jwksUrl))
  const { payload } = await jwtVerify(token, JWKS)
  const sub = payload?.sub || payload?.userId
  if (!sub) throw new Error('Missing subject in Privy token')

  // Try to get wallet address via server SDK if available
  try {
    const { PrivyClient } = require('@privy-io/server-auth')
    if (PrivyClient && process.env.PRIVY_APP_SECRET) {
      const client = new PrivyClient(appId, process.env.PRIVY_APP_SECRET)
      const user = await client.getUser(String(sub))
      const addr = user?.wallet?.address || (Array.isArray(user?.linked_accounts) ? user.linked_accounts.find(a => a?.type?.includes('wallet'))?.address : null)
      const address = normalizeAddress(addr)
      if (address) return { address, userId: String(sub), user }
    }
  } catch (_) {}
  // Fallback: no wallet lookup; let caller use dev header fallback
  return { userId: String(sub) }
}

function devFallbackAllowed() {
  const explicit = process.env.AUTH_ALLOW_DEV_FALLBACK
  if (explicit === 'true') return true
  if (explicit === 'false') return false
  const context = process.env.CONTEXT
  if (context && context.toLowerCase() === 'production') return false
  if (process.env.NETLIFY_DEV === 'true') return true
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') return true
  return false
}

async function verifyAuth(event = {}) {
  const headers = event.headers || {}
  const authHeader = headerLookup(headers, 'authorization')
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (!token) return { error: 'Missing token' }
    // First try our JWT
    try {
      const decoded = await verifyJwtToken(token)
      return { address: decoded.address, tokenPayload: decoded.payload, method: 'jwt' }
    } catch (_) {}
    // Then try Privy access token
    try {
      const privy = await verifyPrivyToken(token)
      if (privy?.address) return { address: privy.address, privyUserId: privy.userId, method: 'privy' }
      // If we can't resolve a wallet address from Privy token, allow dev header fallback below
    } catch (err) {
      // continue to dev fallback
    }
  }

  if (devFallbackAllowed()) {
    const devHeader = headerLookup(headers, 'x-wallet-address')
    const fromQuery = event.queryStringParameters?.wallet || event.queryStringParameters?.address
    const candidate = normalizeAddress(devHeader || fromQuery)
    if (candidate) {
      return { address: candidate, dev: true }
    }
  }

  return { error: 'Not authenticated' }
}

function issueNonce() {
  return crypto.randomBytes(16).toString('hex')
}

module.exports = {
  json,
  verifyAuth,
  normalizeAddress,
  issueNonce,
}

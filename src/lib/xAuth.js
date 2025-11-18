import { supabase } from './supabase'

const DEFAULT_CLIENT_ID = 'dTJGTzhNb1NQRi1SY2hZY1EtYjA6MTpjaQ'
const DEFAULT_REDIRECT_URI = 'https://picks.run/x/callback'
const DEFAULT_SCOPE = 'tweet.read users.read offline.access'
const DEFAULT_AUDIENCE = 'https://api.x.com/2/'

const STORAGE_KEYS = {
  codeVerifier: 'x_pkce_code_verifier',
  state: 'x_oauth_state',
  sessionToken: 'x_oauth_session_token',
  pendingCallback: 'x_oauth_pending_callback',
}

export function getXOauthConfig() {
  if (typeof window === 'undefined') return null
  const clientId = DEFAULT_CLIENT_ID
  const redirectUri = DEFAULT_REDIRECT_URI
  const scope = DEFAULT_SCOPE
  const audience = DEFAULT_AUDIENCE
  const config = { clientId: clientId.trim(), redirectUri: redirectUri.trim(), scope: scope.trim(), audience: audience.trim() }
  return config
}

function saveSession(key, value) {
  try {
    sessionStorage.setItem(key, value)
  } catch (err) {
    console.warn('[X OAuth] Failed to persist session state', err)
  }
}

function getSession(key) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function clearSession(keys) {
  keys.forEach((key) => {
    try { sessionStorage.removeItem(key) } catch {}
  })
}

export async function startXOauthSignIn({ privyUserId }) {
  if (typeof window === 'undefined') return
  if (!privyUserId) {
    throw new Error('Privy session required before connecting X account.')
  }
  try {
    const { data, error } = await supabase.functions.invoke('x-oauth-start', { body: { privyUserId } })
    if (error) throw new Error(error.message || 'Failed to initiate X authorization.')
    const { authorizeUrl, state, codeVerifier, sessionToken } = data || {}
    if (!authorizeUrl || !state || !codeVerifier || !sessionToken) {
      throw new Error('Incomplete response from X authorization start.')
    }
    clearSession([STORAGE_KEYS.state, STORAGE_KEYS.codeVerifier, STORAGE_KEYS.sessionToken])
    saveSession(STORAGE_KEYS.state, state)
    saveSession(STORAGE_KEYS.codeVerifier, codeVerifier)
    saveSession(STORAGE_KEYS.sessionToken, sessionToken)
    window.location.assign(authorizeUrl)
  } catch (err) {
    console.error('[X OAuth] start failed', err)
    alert(err?.message || 'Unable to start X authorization. Please try again.')
    throw err
  }
}

export async function exchangeCodeForToken({ code, returnedState, privyUserId }) {
  if (!privyUserId) {
    throw new Error('Privy session required to finalize X authorization.')
  }
  const storedState = getSession(STORAGE_KEYS.state)
  const codeVerifier = getSession(STORAGE_KEYS.codeVerifier)
  const sessionToken = getSession(STORAGE_KEYS.sessionToken)

  const { data, error } = await supabase.functions.invoke('x-oauth-exchange', {
    body: {
      code,
      state: storedState || returnedState || '',
      codeVerifier: codeVerifier || '',
      sessionToken: sessionToken || '',
      privyUserId,
    },
  })
  if (error) {
    throw new Error(error.message || 'Failed to exchange authorization code.')
  }

  const xUser = data?.xUser
  const user = data?.user
  if (!xUser?.id && !user?.x_user_id) {
    throw new Error('Server response missing X account details.')
  }
  clearSession([STORAGE_KEYS.codeVerifier, STORAGE_KEYS.state, STORAGE_KEYS.sessionToken])
  return {
    xUser,
    user,
    bypassed: Boolean(data?.bypassed),
  }
}

export function getXOauthCallbackUrl() {
  return DEFAULT_REDIRECT_URI
}

export function storeXOauthCallbackPayload(payload) {
  if (typeof window === 'undefined') return
  try {
    const safePayload = JSON.stringify({
      ...payload,
      storedAt: Date.now(),
    })
    saveSession(STORAGE_KEYS.pendingCallback, safePayload)
  } catch (err) {
    console.warn('[X OAuth] failed to store callback payload', err)
  }
}

export function consumeXOauthCallbackPayload() {
  if (typeof window === 'undefined') return null
  const raw = getSession(STORAGE_KEYS.pendingCallback)
  if (!raw) return null
  clearSession([STORAGE_KEYS.pendingCallback])
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.warn('[X OAuth] failed to parse stored callback payload', err)
    return null
  }
}

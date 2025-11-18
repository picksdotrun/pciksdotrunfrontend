const { createClient } = require('@supabase/supabase-js')
const { json, verifyAuth, normalizeAddress } = require('./_lib/auth.cjs')

function getAdminClient() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase admin credentials are not configured')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const supabase = getAdminClient()

function sanitizeIdentifier(value, { lower = false, limit = 128 } = {}) {
  if (typeof value !== 'string') return null
  let trimmed = value.trim()
  if (!trimmed) return null
  if (lower) trimmed = trimmed.toLowerCase()
  if (limit && trimmed.length > limit) trimmed = trimmed.slice(0, limit)
  return trimmed
}

async function findExistingUser({ privyUserId, walletAddress, oauthIdentifier, email }) {
  if (privyUserId) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('privy_user_id', privyUserId)
      .maybeSingle()
    if (data) return data
  }
  if (walletAddress) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('wallet', walletAddress)
      .maybeSingle()
    if (data) return data
  }
  if (oauthIdentifier) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('oauth_identifier', oauthIdentifier)
      .maybeSingle()
    if (data) return data
  }
  if (email) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle()
    if (data) return data
  }
  return null
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  const authResult = await verifyAuth(event)
  if (authResult.error) {
    return json(401, { error: 'Not authenticated' })
  }

  let payload = {}
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const walletAddress = normalizeAddress(payload.walletAddress || authResult.address)
  const privyUserId = sanitizeIdentifier(payload.privyUserId || authResult.privyUserId, { limit: 64 })
  const oauthIdentifier = sanitizeIdentifier(payload.oauthIdentifier, { limit: 128 })
  const email = sanitizeIdentifier(payload.email, { lower: true, limit: 320 })

  if (!walletAddress && !privyUserId && !oauthIdentifier && !email) {
    return json(400, { error: 'Missing identifiers' })
  }

  try {
    const existing = await findExistingUser({ privyUserId, walletAddress, oauthIdentifier, email })
    const updatePayload = {}
    if (walletAddress) updatePayload.wallet = walletAddress
    if (privyUserId) updatePayload.privy_user_id = privyUserId
    if (oauthIdentifier) updatePayload.oauth_identifier = oauthIdentifier
    if (email) updatePayload.email = email
    updatePayload.auth_method = privyUserId ? 'privy' : (walletAddress ? 'walletconnect' : null)

    let result = null
    if (existing) {
      const { data, error } = await supabase
        .from('users')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle()
      if (error) throw error
      result = data
    } else {
      const { data, error } = await supabase
        .from('users')
        .insert(updatePayload)
        .select('*')
        .maybeSingle()
      if (error) throw error
      result = data
    }

    return json(200, { user: result, isNewUser: !existing })
  } catch (err) {
    console.error('[privy-auth] failed', err)
    return json(500, { error: 'Internal error' })
  }
}

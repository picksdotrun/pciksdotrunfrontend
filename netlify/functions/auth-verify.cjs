// Netlify Function: auth-verify
// Verifies a MetaMask signature and returns a signed JWT for subsequent requests.

const { json, normalizeAddress } = require('./_lib/auth.cjs')
const { TextEncoder } = require('util')

function buildMessage(address, nonce, issuedAt) {
  const lines = [
    'Picks Sign-in',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
  ]
  if (issuedAt) lines.push(`Issued At: ${issuedAt}`)
  return lines.join('\n')
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }
  const address = normalizeAddress(body?.address)
  const nonce = typeof body?.nonce === 'string' ? body.nonce : ''
  const signature = typeof body?.signature === 'string' ? body.signature : ''
  const issuedAt = typeof body?.issuedAt === 'string' ? body.issuedAt : undefined
  if (!address || !nonce || !signature) return json(400, { error: 'Missing address, nonce, or signature' })

  try {
    const { recoverPersonalSignature } = require('@metamask/eth-sig-util')
    let recovered
    try {
      recovered = normalizeAddress(recoverPersonalSignature({
        data: `0x${Buffer.from(buildMessage(address, nonce, issuedAt), 'utf8').toString('hex')}`,
        signature,
      }))
    } catch (err) {
      console.error('[auth-verify] signature verification failed', err)
      return json(401, { error: 'Signature verification failed' })
    }
    if (!recovered || recovered !== address) return json(401, { error: 'Signature mismatch' })

    const secret = process.env.AUTH_JWT_SECRET
    if (!secret) return json(500, { error: 'AUTH_JWT_SECRET not configured' })

    const { SignJWT } = await import('jose')
    const encoder = new TextEncoder()
    const expiresInSeconds = 3 * 24 * 60 * 60 // 3 days
    const token = await new SignJWT({ address })
      .setSubject(address)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .sign(encoder.encode(secret))

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    return json(200, { token, address, expiresAt })
  } catch (err) {
    return json(500, { error: err?.message || 'Auth verification error' })
  }
}

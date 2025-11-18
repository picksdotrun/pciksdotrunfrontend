// Netlify Function: auth-nonce
// Issues a one-time nonce for MetaMask-based authentication.

const { json, normalizeAddress, issueNonce } = require('./_lib/auth.cjs')

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })
  const address = normalizeAddress(event.queryStringParameters?.address || event.queryStringParameters?.wallet)
  if (!address) return json(400, { error: 'Missing or invalid address' })
  const nonce = issueNonce()
  const issuedAt = new Date().toISOString()
  return json(200, { address, nonce, issuedAt })
}

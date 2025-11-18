// Netlify Function: wallet
// Returns public address and live balance (SOL) of the launch wallet, or an address passed via query.

const { Connection, PublicKey, Keypair } = require('@solana/web3.js')

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'
const DEV_WALLET_PUBLIC_KEY = process.env.DEV_WALLET_PUBLIC_KEY
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY

function parsePrivateKey(privateKeyString) {
  if (!privateKeyString) throw new Error('Private key is required')
  try {
    const secretKey = Buffer.from(privateKeyString, 'base64')
    if (secretKey.length === 64) return Keypair.fromSecretKey(secretKey)
  } catch {}
  try {
    const bs58 = require('bs58').default
    const decoded = bs58.decode(privateKeyString)
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded)
  } catch {}
  try {
    const keyArray = JSON.parse(privateKeyString)
    if (Array.isArray(keyArray) && keyArray.length === 64) return Keypair.fromSecretKey(new Uint8Array(keyArray))
  } catch {}
  try {
    const values = privateKeyString.split(',').map((v) => parseInt(v.trim()))
    if (values.length === 64 && values.every((v) => !isNaN(v) && v >= 0 && v <= 255))
      return Keypair.fromSecretKey(new Uint8Array(values))
  } catch {}
  throw new Error('Invalid private key format')
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  try {
    const params = new URLSearchParams(event.rawQuery || event.queryStringParameters)
    const addrParam = (params && (params.get ? params.get('address') : params.address)) || null

    let publicKeyStr = addrParam || DEV_WALLET_PUBLIC_KEY || null
    if (!publicKeyStr && DEV_WALLET_PRIVATE_KEY) {
      try {
        const kp = parsePrivateKey(DEV_WALLET_PRIVATE_KEY)
        publicKeyStr = kp.publicKey.toBase58()
      } catch (_) {}
    }
    if (!publicKeyStr) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No address available' }) }
    }

    const connection = new Connection(RPC_URL, { commitment: 'confirmed' })
    const balanceLamports = await connection.getBalance(new PublicKey(publicKeyStr))
    const balanceSol = balanceLamports / 1e9
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, publicKey: publicKeyStr, balanceLamports, balanceSol }),
      headers: { 'Content-Type': 'application/json' },
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}


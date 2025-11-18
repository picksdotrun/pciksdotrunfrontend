import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js'

export function getPhantomProvider() {
  if (typeof window === 'undefined') return null
  const anyWindow = window
  if ('solana' in anyWindow) {
    const provider = anyWindow.solana
    if (provider?.isPhantom) return provider
  }
  return null
}

export async function ensurePhantomConnected() {
  const provider = getPhantomProvider()
  if (!provider) throw new Error('Phantom wallet not found. Please install Phantom.')
  try {
    const res = await provider.connect({ onlyIfTrusted: false })
    const pubkey = (res?.publicKey || provider.publicKey)?.toString?.() || null
    if (!pubkey) throw new Error('Failed to get Phantom public key')
    return { provider, publicKey: pubkey }
  } catch (e) {
    throw new Error(e?.message || 'User rejected connection')
  }
}

export function getRpcUrl() {
  // Prefer Helius if a key is provided via Vite env
  const helKey = import.meta.env.VITE_HELIUS_KEY || import.meta.env.VITE_HELIOUS_KEY
  if (helKey && String(helKey).trim().length > 0) {
    return `https://rpc.helius.xyz/?api-key=${helKey}`
  }
  return import.meta.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com'
}

export function makeConnection() {
  return new Connection(getRpcUrl(), { commitment: 'confirmed' })
}

export function decodeSwapTransactionBase64(base64, type) {
  // Decode base64 to Uint8Array without Node Buffer
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (type === 'v0') {
    return VersionedTransaction.deserialize(bytes)
  }
  return Transaction.from(bytes)
}

import { makeConnection, decodeSwapTransactionBase64, ensurePhantomConnected } from './phantom'

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112'

export async function requestSwapTx({ toMint, payer, amount = 0.01, slippage = 10 }) {
  const base = import.meta.env.VITE_SOLANA_TRACKER_SWAP_BASE_URL || 'https://swap-v2.solanatracker.io'
  const url = new URL('/swap', base.endsWith('/') ? base : base + '/')
  url.searchParams.set('from', NATIVE_SOL_MINT)
  url.searchParams.set('to', toMint)
  url.searchParams.set('fromAmount', String(amount))
  url.searchParams.set('slippage', String(slippage))
  url.searchParams.set('payer', payer)
  url.searchParams.set('txVersion', 'v0')

  const headers = { Accept: 'application/json' }
  const apiKey = import.meta.env.VITE_SOLANA_TRACKER_API_KEY || import.meta.env.VITE_SWAP_API_KEY
  const fetchOpts = { method: 'GET', headers: apiKey ? { ...headers, 'x-api-key': apiKey } : headers }
  const res = await fetch(url.toString(), fetchOpts)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Swap API request failed')
  if (!json?.txn) throw new Error('Swap API returned no transaction')
  return json
}

export async function swapSolToMint({ toMint, amountSol = 0.01, slippage = 10 }) {
  const { provider, publicKey } = await ensurePhantomConnected()
  // Build v0 tx via SolanaTracker and submit with Phantom
  const swap = await requestSwapTx({ toMint, payer: publicKey, amount: amountSol, slippage })
  const tx = decodeSwapTransactionBase64(swap.txn, swap.type)
  const connection = makeConnection()
  try { await connection.simulateTransaction(tx, { sigVerify: false }) } catch (_) {}
  const { signature } = await provider.signAndSendTransaction(tx)
  await connection.getSignatureStatus(signature)
  return signature
}

async function fetchJupiterQuote({ inputMint, outputMint, amountLamports, slippageBps }) {
  const base = import.meta.env.VITE_JUPITER_BASE_URL || 'https://quote-api.jup.ag'
  const url = new URL('/v6/quote', base.endsWith('/') ? base : base + '/')
  url.searchParams.set('inputMint', inputMint)
  url.searchParams.set('outputMint', outputMint)
  url.searchParams.set('amount', String(amountLamports))
  url.searchParams.set('slippageBps', String(slippageBps))
  url.searchParams.set('onlyDirectRoutes', 'false')
  const res = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Jupiter quote failed')
  return json
}

async function requestJupiterSwapTx({ quoteResponse, userPublicKey, asLegacy = true, computeUnitPriceMicroLamports }) {
  const base = import.meta.env.VITE_JUPITER_BASE_URL || 'https://quote-api.jup.ag'
  const url = new URL('/v6/swap', base.endsWith('/') ? base : base + '/')
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    useVersionedTransaction: !asLegacy,
    asLegacyTransaction: asLegacy,
  }
  if (computeUnitPriceMicroLamports) body.computeUnitPriceMicroLamports = computeUnitPriceMicroLamports
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Jupiter swap build failed')
  return json
}

async function swapViaJupiter({ toMint, provider, publicKey, amountSol, slippage }) {
  const amountLamports = Math.max(1, Math.floor(amountSol * 1e9))
  const slippageBps = Math.max(1, Math.floor(Number(slippage) * 100))
  const quote = await fetchJupiterQuote({
    inputMint: NATIVE_SOL_MINT,
    outputMint: toMint,
    amountLamports,
    slippageBps,
  })
  if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
    throw new Error('No Jupiter route available')
  }
  const { swapTransaction } = await requestJupiterSwapTx({ quoteResponse: quote, userPublicKey: publicKey, asLegacy: true })
  if (!swapTransaction) throw new Error('Jupiter returned no transaction')
  const tx = decodeSwapTransactionBase64(swapTransaction, 'legacy')
  const connection = makeConnection()
  try { await connection.simulateTransaction(tx, { sigVerify: false }) } catch (_) {}
  if (provider.signAndSendTransaction) {
    const { signature } = await provider.signAndSendTransaction(tx)
    await connection.getSignatureStatus(signature)
    return signature
  }
  const signed = await provider.signTransaction(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 4 })
  await connection.confirmTransaction(sig, 'confirmed')
  return sig
}

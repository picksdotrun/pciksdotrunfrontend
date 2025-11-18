// Netlify Function: Launch two tokens (UNDER and OVER) using the provided DBC code
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY,
// optional: DEV_WALLET_PRIVATE_KEY, RPC_URL

const {
  Connection,
  PublicKey,
  Keypair,
  TransactionExpiredBlockheightExceededError,
  Transaction,
  ComputeBudgetProgram,
} = require('@solana/web3.js')
const { DynamicBondingCurveClient, deriveDbcPoolAddress } = require('@meteora-ag/dynamic-bonding-curve-sdk')
const bs58 = require('bs58').default
const BN = require('bn.js')
const { createClient } = require('@supabase/supabase-js')

const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'
const INITIAL_BUY_SOL_PER_SIDE = parseFloat(process.env.INITIAL_BUY_SOL_PER_SIDE || '0.01')

// Meteora Inkwell config (example from user content)
const INKWELL_CONFIG_ADDRESS = new PublicKey('4wGDGetHZYw6c6MJkiqz8LL5nHMnWvgLGTcF7dypSzGi')

if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Missing Supabase credentials for function')
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

function isValidUrl(string) {
  try {
    const url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_) {
    return false
  }
}

function isValidTwitterUrl(string) {
  try {
    const url = new URL(string)
    return (
      url.hostname === 'twitter.com' ||
      url.hostname === 'x.com' ||
      url.hostname === 'www.twitter.com' ||
      url.hostname === 'www.x.com'
    )
  } catch (_) {
    return false
  }
}

function validateMetadata(metadata) {
  const errors = []
  if (!metadata.name || metadata.name.trim().length === 0) errors.push('Token name is required')
  if (metadata.name && metadata.name.length > 32) errors.push('Token name must be 32 chars or less')
  if (!metadata.symbol || metadata.symbol.trim().length === 0) errors.push('Token symbol is required')
  if (metadata.symbol && metadata.symbol.length > 10) errors.push('Token symbol must be 10 chars or less')
  if (metadata.symbol && !/^[A-Z0-9]+$/i.test(metadata.symbol)) errors.push('Token symbol must be alphanumeric')
  if (metadata.description && metadata.description.length > 500) errors.push('Description max 500 chars')
  if (metadata.website && !isValidUrl(metadata.website)) errors.push('Website must be a valid URL')
  if (metadata.twitter && !isValidTwitterUrl(metadata.twitter)) errors.push('Twitter must be a valid URL')
  if (metadata.initialBuyAmount !== undefined) {
    const amount = parseFloat(metadata.initialBuyAmount)
    if (isNaN(amount) || amount < 0) errors.push('Initial buy must be positive')
    if (amount > 10) errors.push('Initial buy cannot exceed 10 SOL')
  }
  return errors
}

function parsePrivateKey(privateKeyString) {
  if (!privateKeyString) throw new Error('Private key is required')
  try {
    const secretKey = Buffer.from(privateKeyString, 'base64')
    if (secretKey.length === 64) return Keypair.fromSecretKey(secretKey)
  } catch {}
  try {
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

async function uploadMetadata(metadata, mintAddress) {
  const maxRetries = 3
  let lastError
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let imageUrl
      if (metadata.image) {
        const fileExt = metadata.imageType?.split('/')[1] || 'png'
        const fileName = `token-${mintAddress}.${fileExt}`
        const filePath = `posts/${fileName}`
        let fileBuffer
        if (Buffer.isBuffer(metadata.image)) fileBuffer = metadata.image
        else if (typeof metadata.image === 'string') {
          if (metadata.image.startsWith('data:')) {
            const header = metadata.image.substring(5, metadata.image.indexOf(',')) // e.g. image/png;base64
            const typePart = header.split(';')[0] // image/png
            if (!metadata.imageType && typePart) metadata.imageType = typePart
            const base64Data = metadata.image.split(',')[1]
            fileBuffer = Buffer.from(base64Data, 'base64')
          } else fileBuffer = Buffer.from(metadata.image, 'base64')
        } else throw new Error('Invalid image format')
        if (fileBuffer.length > 10 * 1024 * 1024) throw new Error('Image too large')
        const { error: uploadError } = await supabase.storage.from('post-media').upload(filePath, fileBuffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: metadata.imageType || 'image/png',
        })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('post-media').getPublicUrl(filePath)
        imageUrl = urlData.publicUrl
      }
      const metadataJson = {
        name: metadata.name.substring(0, 32),
        symbol: metadata.symbol.substring(0, 10),
        description: (metadata.description || '').substring(0, 500),
        image: imageUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${mintAddress}`,
        attributes: [],
        properties: { files: imageUrl ? [{ uri: imageUrl, type: metadata.imageType || 'image/png' }] : [], category: 'image', creators: [] },
      }
      if (metadata.website) metadataJson.external_url = metadata.website
      const socialLinks = {}
      if (metadata.twitter) {
        socialLinks.twitter = metadata.twitter
        metadataJson.attributes.push({ trait_type: 'twitter', value: metadata.twitter })
      }
      if (metadata.website) {
        socialLinks.website = metadata.website
        metadataJson.attributes.push({ trait_type: 'website', value: metadata.website })
      }
      if (Object.keys(socialLinks).length > 0) metadataJson.extensions = socialLinks
      const metadataBuffer = Buffer.from(JSON.stringify(metadataJson, null, 2))
      const metadataPath = `posts/token-metadata-${mintAddress}.json`
      const { error: metadataError } = await supabase.storage
        .from('post-media')
        .upload(metadataPath, metadataBuffer, { cacheControl: '3600', upsert: true, contentType: 'application/json' })
      if (metadataError) throw metadataError
      const { data: metadataUrlData } = supabase.storage.from('post-media').getPublicUrl(metadataPath)
      return metadataUrlData.publicUrl
    } catch (error) {
      lastError = error
      if (attempt === maxRetries) break
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastError || new Error('Failed to upload metadata')
}

async function getUserDevWallet(userId) {
  if (!userId) return null
  try {
    const { data, error } = await supabase.from('users').select('dev_wallet_private_key').eq('id', userId).single()
    if (error) return null
    return data?.dev_wallet_private_key || null
  } catch {
    return null
  }
}

async function launchTokenDBC(metadata, userId, userPrivateKey) {
  const validation = validateMetadata(metadata)
  if (validation.length) return { success: false, error: `Validation failed: ${validation.join(', ')}` }
  if (!userId && !userPrivateKey && !DEV_WALLET_PRIVATE_KEY) return { success: false, error: 'User ID or private key required' }

  let connection
  try {
    connection = new Connection(RPC_URL, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60000 })
    await connection.getLatestBlockhash()

    const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed')
    const priv = userPrivateKey || (await getUserDevWallet(userId)) || DEV_WALLET_PRIVATE_KEY
    if (!priv) return { success: false, error: 'No private key available' }
    const userKeypair = parsePrivateKey(priv)

    const balance = await connection.getBalance(userKeypair.publicKey)
    if (balance < 0.02 * 1e9) return { success: false, error: 'Insufficient balance (need ~0.02 SOL)' }

    let baseMintKP = Keypair.generate()
    let metadataUri
    try {
      metadataUri = await uploadMetadata(metadata, baseMintKP.publicKey.toString())
    } catch (e) {
      // Fallback to a direct image URI if storage isn't configured
      metadataUri = `https://api.dicebear.com/7.x/identicon/svg?seed=${baseMintKP.publicKey.toString()}`
    }

    // Try atomic create + first buy when provided
    const wantsBuy = metadata.initialBuyAmount && metadata.initialBuyAmount > 0
    let createIxs = []
    let buyIxs = []
    if (wantsBuy) {
      try {
        const { createPoolTx, swapBuyTx } = await dbcClient.pool.createPoolWithFirstBuy({
          createPoolParam: {
            baseMint: baseMintKP.publicKey,
            config: INKWELL_CONFIG_ADDRESS,
            name: metadata.name.substring(0, 32),
            symbol: metadata.symbol.substring(0, 10),
            uri: metadataUri,
            payer: userKeypair.publicKey,
            poolCreator: userKeypair.publicKey,
          },
          firstBuyParam: {
            buyer: userKeypair.publicKey,
            buyAmount: new BN(Math.floor(metadata.initialBuyAmount * 1e9)),
            minimumAmountOut: new BN(1),
            referralTokenAccount: null,
          },
        })
        createIxs = createPoolTx.instructions
        buyIxs = swapBuyTx?.instructions || []
      } catch (_) {}
    }
    if (!createIxs.length) {
      const createPoolTx = await dbcClient.pool.createPool({
        baseMint: baseMintKP.publicKey,
        config: INKWELL_CONFIG_ADDRESS,
        name: metadata.name.substring(0, 32),
        symbol: metadata.symbol.substring(0, 10),
        uri: metadataUri,
        payer: userKeypair.publicKey,
        poolCreator: userKeypair.publicKey,
      })
      createIxs = createPoolTx.instructions
    }

    const poolAddress = deriveDbcPoolAddress(NATIVE_MINT, baseMintKP.publicKey, INKWELL_CONFIG_ADDRESS).toString()
    const { blockhash } = await connection.getLatestBlockhash('confirmed')

    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500000 })
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 })
    const tx = new Transaction()
    tx.add(priorityFeeIx)
    tx.add(computeLimitIx)
    tx.add(...createIxs)
    if (buyIxs.length) tx.add(...buyIxs)
    tx.feePayer = userKeypair.publicKey
    tx.recentBlockhash = blockhash
    tx.sign(userKeypair, baseMintKP)

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 })
    await connection.confirmTransaction(sig, 'confirmed')

    // Fallback: if atomic first-buy wasn't bundled, perform a separate buy now
    if (wantsBuy && buyIxs.length === 0) {
      try {
        const swap = await dbcClient.pool.swap({
          owner: userKeypair.publicKey,
          pool: new PublicKey(poolAddress),
          amountIn: new BN(Math.floor(metadata.initialBuyAmount * 1e9)),
          minimumAmountOut: new BN(0),
          swapBaseForQuote: false, // SOL -> Token
          referralTokenAccount: null,
          payer: userKeypair.publicKey,
        })
        const prio = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 })
        const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 })
        const buyTx = new Transaction()
        buyTx.add(prio)
        buyTx.add(limit)
        buyTx.add(...swap.instructions)
        buyTx.feePayer = userKeypair.publicKey
        buyTx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
        buyTx.sign(userKeypair)
        const buySig = await connection.sendRawTransaction(buyTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 })
        await connection.confirmTransaction(buySig, 'confirmed')
      } catch (e) {
        // Non-fatal: pool exists but without a seeded trade
        console.error('Separate initial buy failed:', e?.message || e)
      }
    }

    // Log minimal pool info
    await supabase.from('token_pools').insert({
      pool_address: poolAddress,
      token_mint: baseMintKP.publicKey.toString(),
      config_address: INKWELL_CONFIG_ADDRESS.toString(),
      user_id: userId || 'system',
      status: 'active',
      pool_type: 'dbc',
      metadata: { name: metadata.name, symbol: metadata.symbol, metadata_uri: metadataUri, launch_transaction: sig },
    })

    return { success: true, mintAddress: baseMintKP.publicKey.toString(), poolAddress, transactionSignature: sig }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  try {
    const body = JSON.parse(event.body || '{}')
    const { pickId, name, line, category, userId, website, twitter, image } = body
    if (!pickId || !name || !line || !category) {
      return { statusCode: 400, body: JSON.stringify({ error: 'pickId, name, line, category are required' }) }
    }

    const baseDesc = `Prediction market for ${name} ${category} ${line}. LESS = Under, MORE = Over.`
    const underMeta = {
      name: `${name} UNDER ${line}`.slice(0, 32),
      symbol: 'UNDER',
      description: baseDesc,
      website,
      twitter,
      image,
      initialBuyAmount: INITIAL_BUY_SOL_PER_SIDE,
    }
    const overMeta = {
      name: `${name} OVER ${line}`.slice(0, 32),
      symbol: 'OVER',
      description: baseDesc,
      website,
      twitter,
      image,
      initialBuyAmount: INITIAL_BUY_SOL_PER_SIDE,
    }

    // Launch sequentially to avoid double-spend races on the dev wallet
    const underRes = await launchTokenDBC(underMeta, userId)
    const overRes = await launchTokenDBC(overMeta, userId)

    if (!underRes.success || !overRes.success) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Token launch failed', under: underRes, over: overRes }),
      }
    }

    // Persist on picks row (lowercase columns)
    await supabase
      .from('picks')
      .update({
        lesstoken: underRes.mintAddress,
        moretoken: overRes.mintAddress,
        lesspool: underRes.poolAddress,
        morepool: overRes.poolAddress,
      })
      .eq('id', pickId)

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        lessMint: underRes.mintAddress,
        moreMint: overRes.mintAddress,
        lessPool: underRes.poolAddress,
        morePool: overRes.poolAddress,
      }),
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}

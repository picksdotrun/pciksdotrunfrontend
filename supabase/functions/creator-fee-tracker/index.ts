// Supabase Edge Function: creator-fee-tracker
// Given a pickId + transaction hash, fetch the receipt via ANKR,
// decode all Bought() logs for the market, store each trade row,
// and increment cumulative volume + creator-fee totals.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decodeEventLog } from 'npm:viem'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const BOUGHT_ABI = [{
  type: 'event',
  name: 'Bought',
  inputs: [
    { name: 'user', type: 'address', indexed: true },
    { name: 'isYes', type: 'bool', indexed: false },
    { name: 'amountIn', type: 'uint256', indexed: false },
    { name: 'sharesMinted', type: 'uint256', indexed: false },
    { name: 'fee', type: 'uint256', indexed: false },
  ],
}] as const

// keccak256("Bought(address,bool,uint256,uint256,uint256)")
const BOUGHT_TOPIC = '0x652a00c95771f30d4db94b02f388c5e924c33537e8eb009ddbd5e95425c667a1'

function resolveRpcUrl(raw?: string | null) {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://rpc.ankr.com/bsc/${trimmed}`
}

async function invokeVolumeFunction(path: string, payload: Record<string, unknown>, runId: string, serviceUrl: string, serviceKey: string) {
  const url = `${serviceUrl}/functions/v1/${path}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let body: Record<string, unknown> | null = null
    try { body = text ? JSON.parse(text) : null } catch (_) {
      body = null
    }
    if (!res.ok) {
      const errorMessage = (body && body.error) ? String(body.error) : text || 'edge_error'
      throw new Error(errorMessage)
    }
    console.log('[creator-fee-tracker]', runId, `${path.toUpperCase()}_OK`, { payload, body })
  } catch (err) {
    console.error('[creator-fee-tracker]', runId, `${path.toUpperCase()}_ERROR`, err, { payload })
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function getEnv(name: string, required = false): string | undefined {
  const value = Deno.env.get(name) ?? Deno.env.get(name.toLowerCase())
  if (required && (!value || !value.trim())) throw new Error(`Missing env: ${name}`)
  return value?.trim()
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function normalizeAddress(addr: string | null | undefined) {
  if (!addr) return null
  const trimmed = addr.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : null
}

const computePriceBps = (amountWei: bigint, sharesWei: bigint): number | null => {
  try {
    if (amountWei === 0n) return null
    const raw = (sharesWei * 10000n) / amountWei
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    return Math.max(0, Math.min(10000, value))
  } catch {
    return null
  }
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[], runId?: string) {
  const payload = { jsonrpc: '2.0', id: Date.now(), method, params }
  console.log('[creator-fee-tracker]', runId, 'RPC_REQUEST', { method, params })
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || json.error) {
    const message = json?.error?.message || resp.statusText || 'rpc_error'
    console.error('[creator-fee-tracker]', runId, 'RPC_ERROR', { method, message, payload: json })
    throw new Error(message)
  }
  console.log('[creator-fee-tracker]', runId, 'RPC_RESPONSE', { method, result: json.result })
  return json.result
}

async function fetchReceipt(rpcUrl: string, txHash: string, attempts = 8, delayMs = 1500, runId?: string) {
  for (let i = 0; i < attempts; i++) {
    const receipt = await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash], runId).catch((err) => {
      console.warn('[creator-fee-tracker]', runId, 'RECEIPT_FETCH_FAIL', { attempt: i + 1, err: err?.message || err })
      return null
    })
    if (receipt) return receipt
    await sleep(delayMs)
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const runId = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
  console.log('[creator-fee-tracker]', runId, 'START', { method: req.method, ip: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') })

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid JSON' })
    const pickId = typeof body.pickId === 'string' ? body.pickId.trim() : ''
    const txHashRaw = typeof body.txHash === 'string' ? body.txHash.trim().toLowerCase() : ''
    const marketRaw = typeof body.marketAddress === 'string' ? body.marketAddress.trim() : ''

    console.log('[creator-fee-tracker]', runId, 'REQUEST_BODY', { pickId, txHash: txHashRaw, marketAddress: marketRaw })

    if (!pickId) return json(400, { error: 'pickId required' })
    const txHash = txHashRaw && /^0x[0-9a-f]{64}$/.test(txHashRaw) ? txHashRaw : null
    if (!txHash) return json(400, { error: 'Valid txHash required' })
    const marketAddress = normalizeAddress(marketRaw)
    if (!marketAddress) return json(400, { error: 'Valid marketAddress required' })

    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const ANKR_RAW = getEnv('ANKR_API_KEY') || getEnv('ankr_api_key')
    const RPC_URL = resolveRpcUrl(ANKR_RAW) || 'https://rpc.ankr.com/bsc'
    if (!RPC_URL) return json(500, { error: 'Missing ANKR_API_KEY (or ankr_api_key)' })

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: pick } = await supabase
      .from('picks')
      .select('id, evm_market_address, evm_fee_bps, creator_fee_split_bps, creator_id')
      .eq('id', pickId)
      .maybeSingle()
    if (!pick) return json(404, { error: 'Pick not found' })

    const pickMarket = normalizeAddress(pick.evm_market_address as string | null)
    if (!pickMarket || pickMarket !== marketAddress) {
      return json(400, { error: 'marketAddress mismatch' })
    }
    const feeBps = Number(pick.evm_fee_bps || 0)
    const creatorSplitBps = Number(pick.creator_fee_split_bps || 0)
    if (!feeBps || feeBps <= 0) return json(400, { error: 'Pick missing evm_fee_bps' })
    if (!creatorSplitBps || creatorSplitBps <= 0) return json(400, { error: 'Pick missing creator_fee_split_bps' })

    const receipt = await fetchReceipt(RPC_URL, txHash, 12, 2000, runId)
    if (!receipt) return json(409, { error: 'Receipt not yet available. Retry shortly.' })
    console.log('[creator-fee-tracker]', runId, 'RECEIPT', { txHash, blockNumber: receipt.blockNumber, logs: Array.isArray(receipt.logs) ? receipt.logs.length : 0 })

    const logs: any[] = Array.isArray(receipt.logs) ? receipt.logs : []
    if (!logs.length) {
      console.warn('[creator-fee-tracker]', runId, 'NO_LOGS_IN_RECEIPT', { txHash })
    } else {
      const sample = logs.slice(0, 5).map((log) => ({ address: normalizeAddress(log.address), topic: log.topics?.[0]?.toLowerCase() }))
      console.log('[creator-fee-tracker]', runId, 'LOG_SAMPLE', { sample })
    }
    const targetLogs = logs.filter((log) => normalizeAddress(log.address) === marketAddress && Array.isArray(log.topics) && log.topics[0]?.toLowerCase() === BOUGHT_TOPIC)
    if (!targetLogs.length) {
      return json(404, { error: 'No Bought events found for market in this transaction.' })
    }
    console.log('[creator-fee-tracker]', runId, 'BOUGHT_LOGS_FOUND', { count: targetLogs.length })

    const decodedRows: {
      log_index: number
      trader: string | null
      is_yes: boolean
      amount_wei: bigint
      shares_wei: bigint
      fee_wei: bigint
      creator_fee_wei: bigint
    }[] = []

    let totalAmount = 0n
    let totalFee = 0n

    for (const log of targetLogs) {
      try {
        const decoded = decodeEventLog({
          abi: BOUGHT_ABI,
          data: log.data,
          topics: log.topics,
        })
        const args = decoded.args as any
        const amount = BigInt(args.amountIn || 0)
        const fee = BigInt(args.fee || 0)
        const creatorCut = (fee * BigInt(creatorSplitBps)) / BigInt(feeBps)
        decodedRows.push({
          log_index: Number(log.logIndex ?? 0),
          trader: normalizeAddress(args.user) ?? null,
          is_yes: Boolean(args.isYes),
          amount_wei: amount,
          shares_wei: BigInt(args.sharesMinted || 0),
          fee_wei: fee,
          creator_fee_wei: creatorCut,
        })
        totalAmount += amount
        totalFee += fee
      } catch (err) {
        console.warn('[creator-fee-tracker]', runId, 'DECODE_FAIL', { txHash, err: err?.message || err })
      }
    }

    if (!decodedRows.length) return json(422, { error: 'Unable to decode Bought logs for this tx' })
    const blockNumberHex = receipt.blockNumber || targetLogs[0]?.blockNumber
    const blockNumber = blockNumberHex ? Number(BigInt(blockNumberHex)) : null
    let blockTimestamp: string | null = null
    if (blockNumber != null) {
      const blockHex = '0x' + blockNumber.toString(16)
      const block = await rpcCall(RPC_URL, 'eth_getBlockByNumber', [blockHex, false], runId).catch((err) => {
        console.warn('[creator-fee-tracker]', runId, 'BLOCK_FETCH_FAIL', { blockHex, err: err?.message || err })
        return null
      })
      if (block?.timestamp) {
        try {
          const ts = Number(BigInt(block.timestamp))
          blockTimestamp = new Date(ts * 1000).toISOString()
        } catch (_) {
          blockTimestamp = null
        }
      }
    }

    const uniqueTraders = Array.from(new Set(decodedRows.map((row) => row.trader).filter(Boolean))) as string[]
    const traderUserMap = new Map<string, string>()
    if (uniqueTraders.length) {
      console.log('[creator-fee-tracker]', runId, 'LOOKUP_USERS', { traders: uniqueTraders.length })
      const { data: traderUsers, error: traderLookupError } = await supabase
        .from('users')
        .select('id, wallet')
        .in('wallet', uniqueTraders)
      if (traderLookupError) {
        console.error('[creator-fee-tracker]', runId, 'USER_LOOKUP_ERROR', traderLookupError)
      } else {
        for (const userRow of traderUsers || []) {
          const wallet = typeof userRow.wallet === 'string' ? userRow.wallet.trim().toLowerCase() : null
          if (wallet && userRow.id) traderUserMap.set(wallet, userRow.id)
        }
      }
    }

    const missingWallets = uniqueTraders.filter((wallet) => !traderUserMap.has(wallet))
    if (missingWallets.length) {
      console.log('[creator-fee-tracker]', runId, 'MISSING_USERS', { count: missingWallets.length })
      const insertPayload = missingWallets.map((wallet) => ({ wallet, auth_method: 'edge' }))
      const insertRes = await supabase
        .from('users')
        .insert(insertPayload)
        .select('id, wallet')
      let inserted = insertRes.data || []
      if (insertRes.error) {
        console.error('[creator-fee-tracker]', runId, 'USER_INSERT_ERROR', insertRes.error)
        const retry = await supabase
          .from('users')
          .select('id, wallet')
          .in('wallet', missingWallets)
        if (retry.error) {
          console.error('[creator-fee-tracker]', runId, 'USER_LOOKUP_RETRY_ERROR', retry.error)
        } else {
          inserted = retry.data || []
        }
      }
      for (const userRow of inserted) {
        const wallet = typeof userRow.wallet === 'string' ? userRow.wallet.trim().toLowerCase() : null
        if (wallet && userRow.id) {
          traderUserMap.set(wallet, userRow.id)
          console.log('[creator-fee-tracker]', runId, 'USER_LINK', { wallet, userId: userRow.id })
        }
      }
    }

    uniqueTraders.forEach((wallet) => {
      console.log('[creator-fee-tracker]', runId, 'TRADER_USER_MAP', { wallet, userId: traderUserMap.get(wallet) || null })
    })

    const baseTimestampMs = (() => {
      if (blockTimestamp) {
        const parsed = Date.parse(blockTimestamp)
        if (!Number.isNaN(parsed)) return parsed
      }
      return Date.now()
    })()

    const insertRows = decodedRows.map((row, idx) => {
      const priceBps = computePriceBps(row.amount_wei, row.shares_wei)
      return {
        pick_id: pickId,
        tx_hash: txHash,
        log_index: row.log_index,
        trader: row.trader,
        user_id: row.trader ? traderUserMap.get(row.trader) || null : null,
        is_yes: row.is_yes,
        amount_wei: row.amount_wei.toString(),
        shares_wei: row.shares_wei.toString(),
        fee_wei: row.fee_wei.toString(),
        creator_fee_wei: row.creator_fee_wei.toString(),
        yes_price_bps: row.is_yes ? priceBps : null,
        no_price_bps: row.is_yes ? null : priceBps,
        block_number: blockNumber,
        occurred_at: new Date(baseTimestampMs + idx * 1000).toISOString(),
      }
    })
    const userIdsForUpdate = Array.from(new Set(insertRows.map((row) => row.user_id).filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)))

    console.log('[creator-fee-tracker]', runId, 'UPSERT_TRADES', { rows: insertRows.length })

    const insertRes = await supabase
      .from('trades')
      .upsert(insertRows, { onConflict: 'tx_hash,log_index' })
    if (insertRes.error) {
      console.error('[creator-fee-tracker]', runId, 'UPSERT_ERROR', insertRes.error)
      return json(500, { error: 'Failed to store trades', details: insertRes.error.message })
    }

    const totalCreatorFee = (totalFee * BigInt(creatorSplitBps)) / BigInt(feeBps)
    console.log('[creator-fee-tracker]', runId, 'APPLY_TOTALS', {
      totalVolumeWei: totalAmount.toString(),
      totalFeeWei: totalFee.toString(),
      creatorFeeWei: totalCreatorFee.toString(),
    })
    const incrementRes = await supabase.rpc('increment_creator_totals', {
      p_pick_id: pickId,
      p_creator_id: pick.creator_id,
      p_volume_delta: totalAmount.toString(),
      p_creator_fee_delta: totalCreatorFee.toString(),
    })
    if (incrementRes.error) {
      console.error('[creator-fee-tracker]', runId, 'INCREMENT_ERROR', incrementRes.error)
      return json(500, { error: 'Failed to increment totals', details: incrementRes.error.message })
    }

    await invokeVolumeFunction('update-pick-volume', { pickId }, runId, SUPABASE_URL, SERVICE_ROLE_KEY)
    if (userIdsForUpdate.length) {
      await Promise.all(
        userIdsForUpdate.map((userId) =>
          invokeVolumeFunction('update-user-volume', { userId }, runId, SUPABASE_URL, SERVICE_ROLE_KEY),
        ),
      )
    }

    console.log('[creator-fee-tracker]', runId, 'DONE', { tradesInserted: insertRows.length, refreshedUsers: userIdsForUpdate.length })
    return json(200, {
      success: true,
      tradesInserted: insertRows.length,
      totalVolumeWei: totalAmount.toString(),
      creatorFeeWei: totalCreatorFee.toString(),
    })
  } catch (err) {
    console.error('[creator-fee-tracker]', runId, 'FATAL', err)
    return json(500, { error: err?.message || 'Server error' })
  }
})

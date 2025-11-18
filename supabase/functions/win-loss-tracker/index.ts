// Supabase Edge Function: win-loss-tracker
// Builds winner/loser wallet lists for a resolved pick by reading all Bought() logs.

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

const BOUGHT_TOPIC = '0x652a00c95771f30d4db94b02f388c5e924c33537e8eb009ddbd5e95425c667a1'

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const value = Deno.env.get(name) ?? Deno.env.get(name.toLowerCase())
  if (required && (!value || !value.trim())) throw new Error(`Missing env: ${name}`)
  return value?.trim()
}

function normalizeAddress(addr?: string | null) {
  if (!addr) return null
  const trimmed = addr.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : null
}

function resolveRpcUrl(raw?: string | null) {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://rpc.ankr.com/bsc/${trimmed}`
}

async function invokeWinLossTotals(supabaseUrl: string, serviceKey: string, pickId: string, runId: string) {
  if (!supabaseUrl || !serviceKey || !pickId) return { skipped: true }
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/win-loss-totals`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ pickId }),
    })
    const text = await res.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
    if (!res.ok) {
      console.error('[win-loss-tracker]', runId, 'TOTALS_INVOCATION_ERROR', { status: res.status, body })
      return { error: true, status: res.status, body }
    }
    console.log('[win-loss-tracker]', runId, 'TOTALS_UPDATED', body)
    return body
  } catch (err) {
    console.error('[win-loss-tracker]', runId, 'TOTALS_HTTP_ERROR', err)
    return { error: true, message: (err as Error)?.message || String(err) }
  }
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[], runId: string) {
  const payload = { jsonrpc: '2.0', id: Date.now(), method, params }
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    const msg = json?.error?.message || res.statusText || 'rpc_error'
    console.error('[win-loss-tracker]', runId, 'RPC_ERROR', { method, msg })
    throw new Error(msg)
  }
  return json.result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const runId = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
  console.log('[win-loss-tracker]', runId, 'START', { method: req.method })

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid JSON' })
    const pickId = typeof body.pickId === 'string' ? body.pickId.trim() : ''
    if (!pickId) return json(400, { error: 'pickId required' })

    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const ANKR_RAW = getEnv('ANKR_API_KEY') || getEnv('ankr_api_key')
    const RPC_URL = resolveRpcUrl(ANKR_RAW) || 'https://rpc.ankr.com/bsc'

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: pick, error: pickErr } = await supabase
      .from('picks')
      .select('id, evm_market_address, win_side, evm_end_time, resolved_at, created_at')
      .eq('id', pickId)
      .single()
    if (pickErr || !pick) return json(404, { error: 'Pick not found' })
    const market = normalizeAddress(pick.evm_market_address)
    if (!market) return json(400, { error: 'Pick missing evm_market_address' })
    const winSide = (pick.win_side || '').toLowerCase()
    if (winSide !== 'yes' && winSide !== 'no') return json(400, { error: 'Pick not resolved yet' })

    console.log('[win-loss-tracker]', runId, 'PICK_INFO', { pickId, winSide, market })

    console.log('[win-loss-tracker]', runId, 'RPC_SCAN', { pickId })
    const latestHex = await rpcCall(RPC_URL, 'eth_blockNumber', [], runId)
    const latestBlock = Number(BigInt(latestHex))
    const latestBlockData = await rpcCall(RPC_URL, 'eth_getBlockByNumber', ['latest', false], runId)
    const latestTimestamp = Number(BigInt(latestBlockData?.timestamp || '0x0'))
    const targetIso = pick.evm_end_time || pick.resolved_at || pick.created_at
    const targetSeconds = targetIso ? Math.floor(new Date(targetIso).getTime() / 1000) : null
    const avgBlockTime = 3 // seconds
    let approxBlock = latestBlock
    if (targetSeconds && latestTimestamp) {
      const delta = Math.max(0, latestTimestamp - targetSeconds)
      approxBlock = Math.max(0, latestBlock - Math.round(delta / avgBlockTime))
    }
    const window = 25_000
    let rangeEnd = Math.min(latestBlock, approxBlock + window)
    let rangeStart = Math.max(0, approxBlock - window)
    if (rangeEnd <= rangeStart) {
      rangeEnd = Math.min(latestBlock, rangeStart + window)
    }
    const chunkSize = 128
    const logs: any[] = []
    let toBlock = rangeEnd
    while (toBlock >= rangeStart) {
      const fromBlock = Math.max(rangeStart, toBlock - chunkSize + 1)
      console.log('[win-loss-tracker]', runId, 'LOG_RANGE', { from: fromBlock, to: toBlock })
      const params = [{
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        address: market,
        topics: [BOUGHT_TOPIC],
      }]
      try {
        const rangeLogs = await rpcCall(RPC_URL, 'eth_getLogs', params, runId)
        if (Array.isArray(rangeLogs) && rangeLogs.length) logs.push(...rangeLogs)
      } catch (err) {
        console.warn('[win-loss-tracker]', runId, 'RANGE_FAIL', { from: fromBlock, to: toBlock, err: (err as Error)?.message || String(err) })
      }
      if (fromBlock === rangeStart) break
      toBlock = fromBlock - 1
    }
    if (!Array.isArray(logs) || !logs.length) {
      console.warn('[win-loss-tracker]', runId, 'NO_LOGS', { pickId })
      return json(409, { error: 'No trade logs found yet. Retry shortly.' })
    }
    console.log('[win-loss-tracker]', runId, 'LOGS_FOUND', { pickId, logCount: logs.length })

    const yesSet = new Map<string, { wallet: string, amount: bigint }>()
    const noSet = new Map<string, { wallet: string, amount: bigint }>()
    for (const log of logs) {
      try {
        if (normalizeAddress(log.address) !== market) continue
        const topics = Array.isArray(log.topics) ? log.topics : []
        if (!topics.length || topics[0]?.toLowerCase() !== BOUGHT_TOPIC) continue
        const decoded = decodeEventLog({ abi: BOUGHT_ABI, data: log.data, topics })
        const trader = normalizeAddress(decoded.args?.user as string)
        if (!trader) continue
        const isYes = Boolean(decoded.args?.isYes)
        const amount = BigInt(decoded.args?.amountIn || 0n)
        console.log('[win-loss-tracker]', runId, 'DECODED_LOG', { trader, isYes, amount: amount.toString() })
        const target = isYes ? yesSet : noSet
        const existing = target.get(trader)
        target.set(trader, { wallet: trader, amount: existing ? (existing.amount + amount) : amount })
      } catch (err) {
        console.warn('[win-loss-tracker]', runId, 'DECODE_FAIL', { err: (err as Error)?.message || String(err) })
      }
    }

    console.log('[win-loss-tracker]', runId, 'CLASSIFIED', { pickId, yesCount: yesSet.size, noCount: noSet.size })

    const winnersMap = winSide === 'yes' ? yesSet : noSet
    const losersMap = winSide === 'yes' ? noSet : yesSet

    const walletList = new Set([...winnersMap.keys(), ...losersMap.keys()])
    const walletToUserId = new Map<string, string | null>()
    if (walletList.size) {
      const { data: existingUsers } = await supabase
        .from('users')
        .select('id, wallet')
        .in('wallet', Array.from(walletList))
      if (Array.isArray(existingUsers)) {
        for (const row of existingUsers) {
          const wallet = normalizeAddress(row.wallet)
          if (wallet) walletToUserId.set(wallet, row.id)
        }
      }
      const missing = Array.from(walletList).filter((wallet) => !walletToUserId.has(wallet))
      if (missing.length) {
        const insertPayload = missing.map((wallet) => ({ wallet, auth_method: 'edge' }))
        const insertRes = await supabase
          .from('users')
          .insert(insertPayload)
          .select('id, wallet')
        if (insertRes.error) {
          console.error('[win-loss-tracker]', runId, 'USER_INSERT_ERROR', insertRes.error)
        } else if (Array.isArray(insertRes.data)) {
          for (const row of insertRes.data) {
            const wallet = normalizeAddress(row.wallet)
            if (wallet) walletToUserId.set(wallet, row.id)
          }
        }
      }
    }

    const nowIso = new Date().toISOString()
    await supabase
      .from('win_loss_events')
      .delete()
      .eq('pick_id', pickId)

    const rowsToInsert = []
    for (const entry of [
      { map: yesSet, outcome: winSide === 'yes' ? 'win' : 'loss', side: 'yes' },
      { map: noSet, outcome: winSide === 'no' ? 'win' : 'loss', side: 'no' },
    ]) {
      for (const { wallet, amount } of entry.map.values()) {
        rowsToInsert.push({
          pick_id: pickId,
          user_id: walletToUserId.get(wallet) || null,
          user_wallet: wallet,
          side: entry.side,
          outcome: entry.outcome,
          amount_wei: amount.toString(),
          created_at: nowIso,
        })
      }
    }

    if (rowsToInsert.length) {
      const insertRes = await supabase.from('win_loss_events').insert(rowsToInsert)
      if (insertRes.error) {
        console.error('[win-loss-tracker]', runId, 'EVENT_INSERT_ERROR', insertRes.error)
        return json(500, { error: 'Failed to store win/loss events', details: insertRes.error.message })
      }
    }

    await invokeWinLossTotals(SUPABASE_URL, SERVICE_ROLE_KEY, pickId, runId)

    console.log('[win-loss-tracker]', runId, 'DONE', { pickId, winners: winnersMap.size, losers: losersMap.size })
    return json(200, { success: true, pickId, winners: winnersMap.size, losers: losersMap.size })
  } catch (err) {
    console.error('[win-loss-tracker]', runId, 'FATAL', err)
    return json(500, { error: (err as Error)?.message || 'Server error' })
  }
})

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

function getEnv(name: string, required = false): string | undefined {
  const value = Deno.env.get(name) ?? Deno.env.get(name.toLowerCase())
  if (required && (!value || !value.trim())) throw new Error(`Missing env: ${name}`)
  return value?.trim()
}

function normaliseNumeric(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '0'
  if (typeof value === 'string' && value.trim().length) return value.trim()
  return '0'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const runId = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
  console.log('[update-user-volume]', runId, 'START', { method: req.method })

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid JSON' })
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!userId) return json(400, { error: 'userId required' })

    const SUPABASE_URL = getEnv('SUPABASE_URL', true)!
    const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY', true)!
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: totalData, error: totalError } = await supabase
      .rpc('total_user_volume', { p_user_id: userId })
    if (totalError) {
      console.error('[update-user-volume]', runId, 'AGG_ERROR', totalError)
      return json(500, { error: 'Failed to aggregate trades', details: totalError.message })
    }
    const totalWei = normaliseNumeric(totalData ?? '0')
    console.log('[update-user-volume]', runId, 'AGG_RESULT', { userId, totalWei })

    const { error: updateError } = await supabase
      .from('users')
      .update({ trading_volume_wei: totalWei })
      .eq('id', userId)
    if (updateError) {
      console.error('[update-user-volume]', runId, 'UPDATE_ERROR', updateError)
      return json(500, { error: 'Failed to update user volume', details: updateError.message })
    }

    console.log('[update-user-volume]', runId, 'DONE')
    return json(200, { success: true, userId, tradingVolumeWei: totalWei })
  } catch (err) {
    console.error('[update-user-volume]', runId, 'FATAL', err)
    return json(500, { error: err?.message || 'Server error' })
  }
})

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing')

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

    const { userId } = await req.json()
    if (!userId) throw new Error('userId is required')

    const { count, error: countError } = await supabase
      .from('picks')
      .select('*', { head: true, count: 'exact' })
      .eq('creator_id', userId)
    if (countError) throw countError

    const { error: updateError } = await supabase
      .from('users')
      .update({ picks_count: count || 0 })
      .eq('id', userId)
    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true, picks: count || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[picks-counter] error', error)
    return new Response(JSON.stringify({ error: (error as Error).message || 'Unknown error' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

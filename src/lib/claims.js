import { supabase } from './supabase'

export async function claimEvmWinnings({ pickId, marketAddress, wallet }) {
  const payload = { pickId, marketAddress, wallet }
  const { data, error } = await supabase.functions.invoke('claim-evm-market', { body: payload })
  if (error) {
    throw new Error(error.message || 'Failed to claim winnings')
  }
  if (!data?.success) {
    const detail = data?.output?.error || data?.error
    throw new Error(detail || 'Claim failed')
  }
  return data
}

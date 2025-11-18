import { supabase } from './supabase'

export async function launchOverUnderTokens({ pickId, name, line, category, description, image }) {
  // image may be a data URL; pass through to the edge function
  const payload = {
    pickId,
    name,
    line,
    category,
    description: description || '',
    imageBase64: typeof image === 'string' ? image : undefined,
    imageType: (typeof image === 'string' && image.startsWith('data:')) ? image.substring(5, image.indexOf(';')) : undefined,
  }
  const { data, error } = await supabase.functions.invoke('launch-pair', { body: payload })
  if (error) throw new Error(error.message || 'Failed to launch tokens')
  if (!data?.success) throw new Error(data?.error || 'Failed to launch tokens')
  return data
}

export async function launchEvmMarket({ pickId, name, line, category, description, image, marketType = 'native_bnb', durationSec, expiresAt, creatorId }) {
  const payload = { pickId, name, line, category, description: description || '', marketType }
  if (image) payload.image = image
  if (durationSec != null) payload.durationSec = Number(durationSec)
  if (expiresAt) payload.expiresAt = expiresAt
  const { data, error } = await supabase.functions.invoke('launch-evm-market', { body: payload })
  if (error) throw new Error(error.message || 'Failed to deploy EVM market')
  if (!data?.success) throw new Error(data?.error || 'Failed to deploy EVM market')
  if (creatorId) {
    try {
      await supabase.functions.invoke('picks-counter', { body: { userId: creatorId } })
    } catch (counterError) {
      console.error('[launchEvmMarket] picks-counter failed', counterError)
    }
  }
  return data
}

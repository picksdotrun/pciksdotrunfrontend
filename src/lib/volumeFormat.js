import { formatUnits } from './evm'

const DEFAULT_BNB_PRICE_USD = 1000

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const bnbFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

function getBnbUsdPrice() {
  const fromEnv = Number(import.meta.env.VITE_BNB_USD_PRICE || import.meta.env.VITE_BNB_PRICE_USD || '')
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_BNB_PRICE_USD
}

function normaliseWei(value) {
  if (value == null) return null
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return BigInt(Math.trunc(value))
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const normalized = trimmed.includes('.') ? trimmed.split('.')[0] : trimmed
    if (!normalized) return null
    return BigInt(normalized)
  }
  try {
    const asString = value.toString()
    if (asString) {
      const normalized = asString.includes('.') ? asString.split('.')[0] : asString
      return BigInt(normalized)
    }
  } catch {}
  return null
}

export function weiToBnb(wei) {
  try {
    const parsed = normaliseWei(wei)
    if (parsed == null) return null
    const bnb = Number(formatUnits(parsed, 18))
    return Number.isFinite(bnb) ? bnb : null
  } catch {
    return null
  }
}

export function formatBnbAmount(bnb, digitsLarge = 3) {
  if (bnb == null) return null
  if (!Number.isFinite(bnb)) return null
  if (bnb >= 1) return bnb.toFixed(digitsLarge)
  if (bnb >= 0.01) return bnb.toFixed(4)
  return bnb.toFixed(6)
}

export function formatBnbLabel(wei, digitsLarge = 3, suffix = 'bnb') {
  const bnb = weiToBnb(wei)
  if (bnb == null) return '0.000 bnb'
  const amount = formatBnbAmount(bnb, digitsLarge) ?? bnb.toFixed(digitsLarge)
  return `${amount} ${suffix}`
}

export function formatVolumeDisplay(wei) {
  const bnb = weiToBnb(wei)
  if (bnb == null) return '—'
  const bnbLabel = `${formatBnbAmount(bnb) ?? bnb.toFixed(3)} bnb`
  const usdPrice = getBnbUsdPrice()
  if (!usdPrice) {
    return bnbLabel
  }
  const usdValue = currencyFormatter.format(bnb * usdPrice)
  return `${usdValue} (${bnbLabel})`
}

export function formatUsdVolume(wei) {
  const bnb = weiToBnb(wei)
  if (bnb == null) return '—'
  const usdPrice = getBnbUsdPrice()
  if (!usdPrice) return '—'
  return currencyFormatter.format(bnb * usdPrice)
}

export function formatFeeDisplay(wei) {
  const bnb = weiToBnb(wei)
  if (bnb == null) return '—'
  const usdPrice = getBnbUsdPrice()
  const bnbText = `${formatBnbAmount(bnb, 4) ?? bnb.toFixed(4)} bnb`
  if (!usdPrice) return bnbText
  const usdValue = currencyFormatter.format(bnb * usdPrice)
  return `${usdValue} (${bnbText})`
}

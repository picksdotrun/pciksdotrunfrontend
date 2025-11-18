import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers'

export const PRIMARY_BSC_RPC = 'https://rpc.ankr.com/bsc/160d13efb3e044349e40d473f5389b951f34495fa5201b1a47bf9396a06fb693'
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const BSC = {
  chainIdHex: '0x38',
  chainIdDec: 56,
  name: 'BNB Smart Chain',
  native: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  // Use dedicated ANKR RPC with provided API key first
  rpcUrls: [
    PRIMARY_BSC_RPC,
    'https://rpc.ankr.com/bsc',
    'https://bsc-dataseed.binance.org',
  ],
  explorer: 'https://bscscan.com',
}

export const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
]

export const WBNB_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256 wad)'
]

export const MARKET_ABI = [
  'function buyYes(uint256 amount) external',
  'function buyNo(uint256 amount) external',
  'function yesShare() view returns (address)',
  'function noShare() view returns (address)',
  'function cutoffTime() view returns (uint64)',
  'function endTime() view returns (uint64)',
  'function getTotals() view returns (uint256 vaultYes, uint256 vaultNo, uint256 sYes, uint256 sNo)',
  'function finalOutcome() view returns (uint8)'
]

export const MARKET_NATIVE_ABI = [
  'function buyYesWithBNB() payable',
  'function buyNoWithBNB() payable',
  'function claim() external',
  'function claimFor(address user) external',
  'function yesShare() view returns (address)',
  'function noShare() view returns (address)',
  'function cutoffTime() view returns (uint64)',
  'function endTime() view returns (uint64)',
  'function getTotals() view returns (uint256 vaultYes, uint256 vaultNo, uint256 sYes, uint256 sNo)',
  'function finalOutcome() view returns (uint8)'
]

export function getBscScanTx(hash) { return `${BSC.explorer}/tx/${hash}` }
export function getBscScanAddress(addr) { return `${BSC.explorer}/address/${addr}` }

export async function getProvider() {
  if (typeof window === 'undefined') throw new Error('No window')
  const eth = window.ethereum
  if (!eth) throw new Error('No EVM wallet found. Install MetaMask.')
  const provider = new BrowserProvider(eth, 'any')
  return provider
}

export async function ensureBscChain(provider) {
  const network = await provider.send('eth_chainId', [])
  if (network && network.toLowerCase() === BSC.chainIdHex) return true
  try {
    await provider.send('wallet_switchEthereumChain', [{ chainId: BSC.chainIdHex }])
    return true
  } catch (_) {
    await provider.send('wallet_addEthereumChain', [{
      chainId: BSC.chainIdHex,
      chainName: BSC.name,
      nativeCurrency: BSC.native,
      rpcUrls: BSC.rpcUrls,
      blockExplorerUrls: [BSC.explorer],
    }])
    return true
  }
}

export async function connectEvm() {
  const provider = await getProvider()
  await ensureBscChain(provider)
  let accounts = []
  try {
    accounts = await provider.send('eth_accounts', [])
  } catch (_) {
    accounts = []
  }
  if (!accounts || accounts.length === 0) {
    accounts = await provider.send('eth_requestAccounts', [])
  }
  const address = accounts && accounts[0]
  const signer = await provider.getSigner()
  return { provider, signer, address }
}

export async function getErc20(provider, address) {
  return new Contract(address, ERC20_ABI, await provider.getSigner())
}

export async function getMarket(provider, address) {
  return new Contract(address, MARKET_ABI, await provider.getSigner())
}

export async function getNativeMarket(provider, address) {
  return new Contract(address, MARKET_NATIVE_ABI, await provider.getSigner())
}

export { formatUnits, parseUnits }

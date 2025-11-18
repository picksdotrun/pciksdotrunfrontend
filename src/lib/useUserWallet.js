import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PRIMARY_BSC_RPC } from './evm'

const BSC_CHAIN_ID_HEX = '0x38'

export function useUserWallet({ refreshMs = 20000 } = {}) {
  const [publicKey, setPublicKey] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const providerRef = useRef(null)
  const sdkRef = useRef(null)

  const ensureBsc = useCallback(async (eth) => {
    try {
      const current = await eth.request({ method: 'eth_chainId' })
      if (current && current.toLowerCase() === BSC_CHAIN_ID_HEX) return
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_CHAIN_ID_HEX }] })
      } catch (switchErr) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: BSC_CHAIN_ID_HEX,
            chainName: 'BNB Smart Chain',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: [PRIMARY_BSC_RPC, 'https://bsc-dataseed.binance.org'],
            blockExplorerUrls: ['https://bscscan.com'],
          }],
        })
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_CHAIN_ID_HEX }] })
      }
    } catch (err) {
      console.error('[useUserWallet] Failed to switch to BSC', err)
      throw err
    }
  }, [])

  // Prefer an injected MetaMask provider; fall back to MetaMask Mobile SDK when no provider is found.
  const getEthereumProvider = useCallback(async (options = {}) => {
    if (providerRef.current) return providerRef.current

    if (typeof window === 'undefined') {
      if (options.silent) return null
      throw new Error('MetaMask not detected. Install MetaMask to continue.')
    }

    const anyEthereum = window.ethereum
    if (anyEthereum?.providers && Array.isArray(anyEthereum.providers)) {
      const metaMaskProvider = anyEthereum.providers.find((p) => p?.isMetaMask)
      if (metaMaskProvider) {
        providerRef.current = metaMaskProvider
        return metaMaskProvider
      }
    }

    if (anyEthereum?.isMetaMask) {
      providerRef.current = anyEthereum
      return anyEthereum
    }

    try {
      if (!sdkRef.current) {
        const { default: MetaMaskSDK } = await import('@metamask/sdk')
        sdkRef.current = new MetaMaskSDK({
          dappMetadata: {
            name: 'Picks',
            url: typeof window !== 'undefined' ? window.location.origin : 'https://picks.run',
          },
          logging: { developerMode: false },
          useDeeplink: true,
          communicationLayerPreference: 'socket',
        })
      }
      const sdkProvider = sdkRef.current?.getProvider()
      if (sdkProvider) {
        providerRef.current = sdkProvider
        return sdkProvider
      }
    } catch (sdkErr) {
      console.error('[useUserWallet] MetaMask SDK initialisation failed', sdkErr)
      if (!options.silent) throw new Error('MetaMask not detected. Install MetaMask to continue.')
      return null
    }

    if (!options.silent) throw new Error('MetaMask not detected. Install MetaMask to continue.')
    return null
  }, [])

  const connect = useCallback(async () => {
    const eth = await getEthereumProvider({ silent: false })
    setLoading(true)
    setError(null)

    try {
      if (sdkRef.current?.connect) {
        try {
          console.info('[useUserWallet] Triggering MetaMask SDK connect flow')
          await sdkRef.current.connect()
        } catch (sdkErr) {
          console.warn('[useUserWallet] MetaMask SDK connect rejected', sdkErr)
        }
      }

      await ensureBsc(eth)

      let accounts = []
      try {
        accounts = await eth.request({ method: 'eth_accounts' })
      } catch (acctErr) {
        console.warn('[useUserWallet] eth_accounts failed', acctErr)
      }
      if (!accounts || accounts.length === 0) {
        console.info('[useUserWallet] Requesting accounts via eth_requestAccounts')
        accounts = await eth.request({ method: 'eth_requestAccounts' })
      } else {
        console.info('[useUserWallet] Using previously authorised MetaMask account')
      }
      const addr = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : null
      if (!addr) throw new Error('MetaMask did not return an account')
      setPublicKey(addr)
      return addr
    } catch (err) {
      console.error('[useUserWallet] connect failed', err)
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [ensureBsc, getEthereumProvider])

  const disconnect = useCallback(async () => {
    setPublicKey(null)
    try { await sdkRef.current?.disconnect?.() } catch (err) { console.debug('[useUserWallet] SDK disconnect error', err) }
    try { sdkRef.current?.terminate?.() } catch (err) { console.debug('[useUserWallet] SDK terminate error', err) }
    providerRef.current = null
  }, [])

  const refresh = useCallback(async () => {
    setLoading(false)
  }, [])

  useEffect(() => {
    let mounted = true
    let cleanup = () => {}

    ;(async () => {
      try {
        const eth = await getEthereumProvider({ silent: true })
        if (!eth || !mounted) return

        const accounts = await eth.request({ method: 'eth_accounts' })
        const addr = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : null
        if (mounted) setPublicKey(addr || null)

        const onAccountsChanged = (accs) => {
          if (!mounted) return
          setPublicKey(Array.isArray(accs) && accs[0] ? String(accs[0]) : null)
        }
        const onChainChanged = () => {}
        eth.on?.('accountsChanged', onAccountsChanged)
        eth.on?.('chainChanged', onChainChanged)
        cleanup = () => {
          try { eth.removeListener?.('accountsChanged', onAccountsChanged) } catch {}
          try { eth.removeListener?.('chainChanged', onChainChanged) } catch {}
        }
      } catch (err) {
        if (!mounted) return
        console.info('[useUserWallet] No authorised MetaMask accounts yet', err)
        setPublicKey(null)
      }
    })()

    return () => {
      mounted = false
      try { cleanup() } catch {}
    }
  }, [getEthereumProvider])

  useEffect(() => {
    if (!publicKey) return
    refresh()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [publicKey, refresh])

  const sol = null
  const tokens = []
  const balanceLabel = useMemo(() => '—', [])

  return { connect, disconnect, refresh, publicKey, sol, tokens, balanceLabel, loading, error }
}

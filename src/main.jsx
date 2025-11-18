import { StrictMode } from 'react'
import { Buffer } from 'buffer'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { PrivyProvider, addRpcUrlOverrideToChain } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { bsc } from 'viem/chains'
import { ProfileProvider } from './contexts/ProfileContext.jsx'

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID
const BSC_RPC_URL = 'https://rpc.ankr.com/bsc/160d13efb3e044349e40d473f5389b951f34495fa5201b1a47bf9396a06fb693'

// Ensure Privy gets a stable Solana connector list so hook ordering never changes.
const solanaConnectors = typeof window !== 'undefined'
  ? toSolanaWalletConnectors({ shouldAutoConnect: false })
  : null

// Global error logging to surface hidden errors
if (typeof window !== 'undefined') {
  // Polyfills for libraries that expect Node globals in the browser
  if (!window.Buffer) window.Buffer = Buffer
  if (!window.global) window.global = window
  window.addEventListener('error', (e) => {
    try { console.error('[Picks][GlobalError]', e?.error || e?.message || e) } catch {}
  })
  window.addEventListener('unhandledrejection', (e) => {
    try { console.error('[Picks][UnhandledRejection]', e?.reason || e) } catch {}
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID || ''}
      chains={[addRpcUrlOverrideToChain(bsc, BSC_RPC_URL)]}
      defaultChain={addRpcUrlOverrideToChain(bsc, BSC_RPC_URL)}
      rpcConfig={{ rpcUrls: { 56: BSC_RPC_URL } }}
      config={{
        networks: { 'eip155:56': { name: 'BNB Smart Chain', rpcUrl: BSC_RPC_URL, chainId: 56 } },
        loginMethods: ['wallet'],
        appearance: {
          theme: 'light',
          walletChainType: 'ethereum-and-solana',
          walletList: ['metamask', 'phantom', 'detected_ethereum_wallets', 'detected_solana_wallets'],
          showWalletLoginFirst: true,
        },
        embeddedWallets: { createOnLogin: 'off', showWalletUIs: false, ethereum: { createOnLogin: 'users-without-wallets' } },
        externalWallets: solanaConnectors ? { solana: { connectors: solanaConnectors } } : undefined,
      }}
    >
      <BrowserRouter>
        <ProfileProvider>
          <App />
        </ProfileProvider>
      </BrowserRouter>
    </PrivyProvider>
  </StrictMode>,
)

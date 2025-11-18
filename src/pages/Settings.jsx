import { useMemo, useState, useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useUserWallet } from '../lib/useUserWallet'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'

export default function Settings() {
  const { publicKey, connect, disconnect, loading } = useUserWallet()
  const { ready, authenticated, user, exportWallet } = usePrivy()
  const short = useMemo(() => (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'), [])
  const [exportStatus, setExportStatus] = useState('')

  const embeddedWallet = useMemo(() => {
    if (!user?.linkedAccounts) return null
    return user.linkedAccounts.find(
      (account) =>
        account.type === 'wallet' &&
        account.walletClientType === 'privy' &&
        account.chainType === 'ethereum'
    ) || null
  }, [user?.linkedAccounts])
  const canExport = ready && authenticated && !!embeddedWallet

  const onExport = useCallback(async () => {
    if (!canExport) return
    try {
      setExportStatus('Opening export modal…')
      const addr = embeddedWallet?.address
      if (addr) {
        await exportWallet({ address: addr })
      } else {
        await exportWallet()
      }
      setExportStatus('Export modal opened')
    } catch (err) {
      console.error('[Settings] export wallet failed', err)
      setExportStatus(err?.message || 'Failed to export wallet')
    }
  }, [canExport, embeddedWallet?.address, exportWallet])

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <Header />
      <Sidebar />
      <div className="md:pl-20 lg:pl-64" style={{ paddingTop: 'var(--header-h, 4rem)' }}>
        <div className="max-w-3xl mx-auto p-4">
          <h1 className="text-2xl font-semibold mb-4">Settings</h1>
          <div className="space-y-6">
            <div className="border border-card-border rounded-lg p-4 bg-card-bg">
              <div className="font-semibold mb-2">MetaMask (EVM)</div>
              <div className="text-sm text-gray-secondary mb-2">Connect your MetaMask wallet for BNB Smart Chain.</div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-secondary">Address:</span>
                <span className="font-mono break-all">{publicKey || '—'}</span>
                {!!publicKey && <span className="text-gray-secondary">({short(publicKey)})</span>}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                {!publicKey ? (
                  <button onClick={connect} disabled={loading} className="px-3 py-2 rounded bg-green-bright text-dark-bg font-semibold disabled:opacity-60 border border-green-bright/80 transition-opacity hover:opacity-90">
                    Connect MetaMask
                  </button>
                ) : (
                  <button onClick={disconnect} className="px-3 py-2 rounded bg-surface-muted text-gray-100 border border-card-border/80 hover:border-green-bright transition-colors">
                    Disconnect
                  </button>
                )}
              </div>
            </div>
            <div className="border border-card-border rounded-lg p-4 bg-card-bg">
              <div className="font-semibold mb-2">Privy Embedded Wallet</div>
              <div className="text-sm text-gray-secondary mb-2">
                Export the private key for your embedded BNB wallet. Keep it secret—anyone with this key controls your funds.
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-secondary">Wallet:</span>
                <span className="font-mono break-all">{embeddedWallet?.address || '—'}</span>
                {!!embeddedWallet?.address && <span className="text-gray-secondary">({short(embeddedWallet.address)})</span>}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <button
                  onClick={onExport}
                  disabled={!canExport}
                  className="px-3 py-2 rounded bg-blue-600 text-white font-semibold disabled:opacity-60 border border-blue-500/80 transition-opacity hover:opacity-90"
                >
                  Export Private Key
                </button>
              </div>
              {!!exportStatus && <div className="text-xs text-gray-secondary mt-2">{exportStatus}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

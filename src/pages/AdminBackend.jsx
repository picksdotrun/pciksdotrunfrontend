import { useEffect, useMemo, useState } from 'react'

const defaultBackendUrl = () => 'https://picksbackend-production.up.railway.app'

function Row({ label, value }) {
  return (
    <tr>
      <th className="text-left border px-3 py-2 bg-gray-50">{label}</th>
      <td className="border px-3 py-2">{value || '—'}</td>
    </tr>
  )
}

export default function AdminBackend() {
  const [backendUrl, setBackendUrl] = useState(defaultBackendUrl())
  const [pin, setPin] = useState('')
  const [status, setStatus] = useState('idle') // idle | signing-in | ready | launching | done | error
  const [error, setError] = useState('')
  const [details, setDetails] = useState([])
  const [launchLogs, setLaunchLogs] = useState('')
  const [launchOk, setLaunchOk] = useState(null)

  const canSignIn = useMemo(() => backendUrl && pin, [backendUrl, pin])

  async function signIn() {
    try {
      setStatus('signing-in')
      setError('')
      const resp = await fetch(`${backendUrl}/mein/arbeit/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ pin }).toString(),
        credentials: 'include',
        mode: 'cors',
      })
      if (!(resp.status === 200 || resp.status === 303)) throw new Error(`Login failed (${resp.status})`)
      setStatus('ready')
      await refreshDetails()
    } catch (e) {
      setStatus('error')
      setError(e?.message || String(e))
    }
  }

  async function refreshDetails() {
    try {
      const resp = await fetch(`${backendUrl}/mein/arbeit`, {
        method: 'GET',
        credentials: 'include',
        mode: 'cors',
        headers: { Accept: 'text/html' },
      })
      const html = await resp.text()
      // Parse table rows from backend admin HTML
      const rows = Array.from(html.matchAll(/<tr><th>(.*?)<\/th><td>(.*?)<\/td><\/tr>/g)).map((m) => [m[1], m[2]])
      setDetails(rows)
    } catch (e) {
      // non-fatal
    }
  }

  async function launch() {
    try {
      setStatus('launching')
      setLaunchLogs('')
      setLaunchOk(null)
      const resp = await fetch(`${backendUrl}/mein/arbeit/launch`, {
        method: 'POST',
        credentials: 'include',
        mode: 'cors',
      })
      const html = await resp.text()
      // Extract logs from <pre>...</pre>
      const m = html.match(/<pre>([\s\S]*?)<\/pre>/)
      const logs = m ? m[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>') : html
      setLaunchLogs(logs)
      setLaunchOk(resp.ok)
      setStatus('done')
    } catch (e) {
      setStatus('error')
      setLaunchOk(false)
      setLaunchLogs(String(e))
      setError(e?.message || String(e))
    }
  }

  useEffect(() => {
    // Try fetch details if cookie already present
    refreshDetails()
  }, [])

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Backend Admin</h1>
      <p className="text-sm text-gray-600 mb-4">Configure backend URL and sign in with your PIN to deploy a test market (vault).</p>

      <div className="grid gap-3 md:grid-cols-3 items-end mb-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">Backend URL</label>
          <input className="w-full border rounded px-3 py-2" placeholder="https://your-backend.example.com" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium">Password PIN</label>
          <input type="password" className="w-full border rounded px-3 py-2" placeholder="••••••" value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-60" disabled={!canSignIn || status === 'signing-in'} onClick={signIn}>
          {status === 'signing-in' ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="bg-emerald-600 text-white px-4 py-2 rounded disabled:opacity-60" disabled={status !== 'ready'} onClick={launch}>
          {status === 'launching' ? 'Launching…' : 'Launch Program (Deploy Test Market)'}
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded mb-4">{error}</div>}

      {!!details?.length && (
        <div className="mb-6">
          <h2 className="font-semibold mb-2">Configuration</h2>
          <div className="overflow-x-auto">
            <table className="min-w-[480px] border">
              <tbody>
                {details.map(([k, v]) => (
                  <Row key={k} label={k} value={v} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {status === 'done' && (
        <div>
          <h2 className="font-semibold mb-2">Result</h2>
          <div className={`mb-2 ${launchOk ? 'text-emerald-700' : 'text-red-700'}`}>
            Status: {launchOk ? 'Success' : 'Error'}
          </div>
          <pre className="bg-black text-white text-sm p-3 rounded overflow-auto max-h-[60vh] whitespace-pre-wrap">{launchLogs}</pre>
        </div>
      )}
    </div>
  )
}

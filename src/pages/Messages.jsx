import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/useProfile'
import { useLocation, useNavigate } from 'react-router-dom'

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')
const PICK_PREFIX = 'PICK:'

export default function Messages() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authenticated, profile, login } = useProfile()
  const userId = profile?.id || null
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [startHandle, setStartHandle] = useState('')
  const [startError, setStartError] = useState('')
  const [starting, setStarting] = useState(false)
  const [selectedUserInfo, setSelectedUserInfo] = useState(null)
  const composerRef = useRef(null)
  const [sharedPicks, setSharedPicks] = useState({})
  const [mobilePane, setMobilePane] = useState('list')
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= 768
  })

  useEffect(() => {
    const onResize = () => {
      const wide = window.innerWidth >= 768
      setIsDesktop(wide)
      if (wide) setMobilePane('list')
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fetchMessages = useCallback(async (withSpinner = true) => {
    if (!userId) return
    if (withSpinner) setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('direct_messages')
        .select(`
          id, body, sender_id, recipient_id, created_at,
          sender:users!direct_messages_sender_id_fkey(id, username, display_name, avatar_url, wallet),
          recipient:users!direct_messages_recipient_id_fkey(id, username, display_name, avatar_url, wallet)
        `)
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: true })
      if (fetchError) throw fetchError
      setMessages(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[Messages] fetch failed', err)
      setError(err?.message || 'Failed to load messages.')
      setMessages([])
    } finally {
      if (withSpinner) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || '')
      const preselect = params.get('user')
      if (preselect) {
        setSelectedUserId(preselect)
      }
    } catch (err) {
      console.error('[Messages] failed to read query params', err)
    }
  }, [location.search])

  useEffect(() => {
    if (!userId) return undefined
    const handleRealtimeUpdate = () => { fetchMessages(false) }
    const channel = supabase
      .channel(`direct-messages:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `sender_id=eq.${userId}` },
        handleRealtimeUpdate,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${userId}` },
        handleRealtimeUpdate,
      )
      .subscribe()
    return () => { try { supabase.removeChannel(channel) } catch {} }
  }, [userId, fetchMessages])

  const threads = useMemo(() => {
    if (!userId) return []
    const threadMap = new Map()
    messages.forEach((msg) => {
      const otherUser = msg.sender_id === userId ? msg.recipient : msg.sender
      if (!otherUser) return
      const existing = threadMap.get(otherUser.id)
      if (!existing || new Date(msg.created_at) > new Date(existing.lastMessage.created_at)) {
        threadMap.set(otherUser.id, { user: otherUser, lastMessage: msg })
      }
    })
    return Array.from(threadMap.values()).sort(
      (a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at),
    )
  }, [messages, userId])

  useEffect(() => {
    if (!selectedUserId && threads.length) {
      setSelectedUserId(threads[0].user.id)
    }
  }, [threads, selectedUserId])

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUserInfo(null)
      return
    }
    const existing = threads.find((thread) => thread.user.id === selectedUserId)?.user
    if (existing) {
      setSelectedUserInfo(existing)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, username, display_name, avatar_url, wallet')
          .eq('id', selectedUserId)
          .maybeSingle()
        if (!cancelled) setSelectedUserInfo(data || null)
      } catch (err) {
        if (!cancelled) setSelectedUserInfo(null)
      }
    })()
    return () => { cancelled = true }
  }, [selectedUserId, threads])

  useEffect(() => {
    if (selectedUserId && composerRef.current) {
      try { composerRef.current.focus() } catch {}
    }
  }, [selectedUserId])

  const filteredMessages = useMemo(() => {
    if (!selectedUserId || !userId) return []
    return messages.filter(
      (msg) =>
        (msg.sender_id === userId && msg.recipient_id === selectedUserId) ||
        (msg.sender_id === selectedUserId && msg.recipient_id === userId),
    )
  }, [messages, selectedUserId, userId])

  useEffect(() => {
    const missingIds = filteredMessages
      .map((msg) => (msg.body?.startsWith(PICK_PREFIX) ? msg.body.slice(PICK_PREFIX.length) : null))
      .filter(Boolean)
      .filter((id) => !sharedPicks[id])
    if (!missingIds.length) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('picks')
          .select('id, name, category, status, created_at, description, image')
          .in('id', missingIds)
        if (error) throw error
        if (!cancelled && data) {
          setSharedPicks((prev) => {
            const next = { ...prev }
            data.forEach((pick) => { next[pick.id] = pick })
            return next
          })
        }
      } catch (err) {
        console.error('[Messages] failed to load shared picks', err)
      }
    })()
    return () => { cancelled = true }
  }, [filteredMessages, sharedPicks])

  const fallbackUser = threads.find((thread) => thread.user.id === selectedUserId)?.user || null
  const selectedUser = selectedUserInfo || fallbackUser
  const handleSelectUser = (id, user) => {
    setSelectedUserId(id)
    if (user) setSelectedUserInfo(user)
    try { navigate(`/messages?user=${id}`) } catch {}
    if (!isDesktop) setMobilePane('thread')
  }

  const handleSend = async (event) => {
    event.preventDefault()
    if (!selectedUserId || !userId) {
      setSendError('Select a conversation or start a new one.')
      return
    }
    const trimmed = input.trim()
    if (!trimmed) {
      setSendError('Enter a message before sending.')
      return
    }
    setSendError('')
    setSending(true)
    try {
      await supabase
        .from('direct_messages')
        .insert({
          sender_id: userId,
          recipient_id: selectedUserId,
          body: trimmed,
        })
      setInput('')
    } catch (err) {
      console.error('[Messages] send failed', err)
      setSendError(err?.message || 'Unable to send message.')
    } finally {
      setSending(false)
    }
  }

  const handleStartConversation = async (event) => {
    event.preventDefault()
    if (!startHandle.trim()) {
      setStartError('Enter a username or wallet address.')
      return
    }
    setStartError('')
    setStarting(true)
    try {
      const value = startHandle.trim()
      const lower = value.toLowerCase()
      if (profile?.wallet && profile.wallet.toLowerCase() === lower) {
        setStartError('You cannot message yourself.')
        setStarting(false)
        return
      }
      const { data, error: userError } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url, wallet')
        .or(`wallet.eq.${lower},username.eq.${value}`)
        .maybeSingle()
      if (userError) throw userError
      if (!data) {
        setStartError('No matching user found.')
        return
      }
      setSelectedUserId(data.id)
      setSelectedUserInfo(data)
      try { navigate(`/messages?user=${data.id}`) } catch {}
      if (!isDesktop) setMobilePane('thread')
      if (!threads.some((thread) => thread.user.id === data.id)) {
        const placeholder = {
          id: `temp-${data.id}`,
          body: '',
          created_at: new Date().toISOString(),
          sender_id: userId,
          recipient_id: data.id,
          sender: profile,
          recipient: data,
        }
        setMessages((prev) => [...prev, placeholder])
      }
      setStartHandle('')
    } catch (err) {
      console.error('[Messages] start conversation failed', err)
      setStartError(err?.message || 'Unable to find that user.')
    } finally {
      setStarting(false)
    }
  }

  const showListPane = isDesktop || mobilePane === 'list'
  const showThreadPane = isDesktop || mobilePane === 'thread'
  const handleBackToList = () => setMobilePane('list')
  const containerStyle = {
    paddingTop: 'calc(var(--header-h, 4rem) + 24px)',
    paddingBottom: '24px',
    minHeight: '100vh',
    height: '100vh',
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-dark-bg text-gray-100 flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-card-bg border border-card-border rounded-3xl p-8 shadow-2xl shadow-black/50 text-center space-y-4">
          <h2 className="text-3xl font-bold text-white">Direct messages</h2>
          <p className="text-gray-secondary text-sm">
            Connect your wallet to chat privately with other Picks creators.
          </p>
          <button
            onClick={async () => { try { await login?.() } catch (err) { console.error('[Messages] login failed', err) } }}
            className="inline-flex items-center justify-center bg-green-bright text-dark-bg font-semibold rounded-full px-6 py-3 text-base hover:opacity-90 transition-opacity"
          >
            Connect wallet
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="box-border bg-dark-bg text-gray-100 px-4 sm:px-6" style={containerStyle}>
      <div className="max-w-6xl mx-auto flex h-full flex-col md:flex-row gap-6">
        <aside
          className={`${showListPane ? 'flex' : 'hidden'} md:flex w-full md:max-w-xs flex-col rounded-2xl border border-card-border bg-card-bg/80 h-full min-h-[380px]`}
        >
            <div className="px-5 py-4 border-b border-card-border/60">
              <h2 className="text-lg font-semibold text-white">Messages</h2>
              <p className="text-xs text-gray-500">All conversations</p>
            </div>
            <form onSubmit={handleStartConversation} className="px-5 py-4 border-b border-card-border/40 space-y-2">
              <input
                type="text"
                value={startHandle}
                onChange={(e) => setStartHandle(e.target.value)}
                placeholder="Search username or wallet"
                className="w-full rounded-xl border border-card-border bg-surface-muted/60 px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:border-cyan-400/60"
              />
              {startError && <p className="text-[11px] text-rose-300">{startError}</p>}
              <button
                type="submit"
                disabled={starting}
                className="w-full rounded-xl border border-cyan-400/60 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
              >
                {starting ? 'Searching…' : 'Start chat'}
              </button>
            </form>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
              {loading ? (
                [...Array(6)].map((_, idx) => (
                  <div key={idx} className="h-14 rounded-xl border border-card-border/40 bg-surface-muted/30 animate-pulse" />
                ))
              ) : threads.length === 0 ? (
                <div className="text-sm text-gray-500 text-center mt-10">No conversations yet.</div>
              ) : (
                threads.map(({ user, lastMessage }) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelectUser(user.id, user)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors flex items-center gap-3 ${
                      selectedUserId === user.id
                        ? 'border-cyan-400/70 bg-cyan-400/10'
                        : 'border-card-border/70 bg-surface-muted/30 hover:border-cyan-400/40'
                    }`}
                  >
                    <AvatarCircle user={user} size="small" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {user.display_name || user.username || shortAddress(user.wallet)}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                          {formatTimestamp(lastMessage.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">{lastMessage.body}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
        </aside>

        <section
          className={`${showThreadPane ? 'flex' : 'hidden'} flex-1 rounded-2xl border border-card-border bg-card-bg/90 flex-col h-full min-h-[420px]`}
        >
            {selectedUser ? (
              <>
                <div className="flex items-center gap-4 border-b border-card-border/60 px-4 sm:px-6 py-4">
                  {!isDesktop && (
                    <button
                      type="button"
                      onClick={handleBackToList}
                      className="inline-flex items-center gap-1 rounded-full border border-card-border/60 px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-gray-300"
                    >
                      ← Back
                    </button>
                  )}
                  <AvatarCircle user={selectedUser} />
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-white truncate">
                      {selectedUser.display_name || selectedUser.username || shortAddress(selectedUser.wallet)}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{shortAddress(selectedUser.wallet)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/profile/${selectedUser.wallet || ''}`)}
                    className="rounded-full border border-card-border px-3 py-1 text-xs text-gray-200 hover:border-green-bright/60"
                  >
                    View profile
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-3 min-h-0">
                  {loading ? (
                    <div className="h-full flex items-center justify-center text-sm text-gray-500 text-center px-6">
                      Loading messages…
                    </div>
                  ) : filteredMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-gray-500 text-center px-6">
                      No messages yet. Say hello!
                    </div>
                  ) : (
                    filteredMessages.map((msg) => {
                      const fromSelf = msg.sender_id === userId
                      return (
                        <div key={msg.id} className={`flex ${fromSelf ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                              fromSelf ? 'bg-green-bright text-dark-bg' : 'bg-surface-muted/60 text-gray-100'
                            }`}
                          >
                            <MessageBodyContent message={msg} sharedPicks={sharedPicks} />
                            <span className="mt-1 block text-[10px] uppercase tracking-wide opacity-70">
                              {formatTimestamp(msg.created_at)}
                            </span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <form onSubmit={handleSend} className="border-t border-card-border/60 px-4 sm:px-6 py-4 flex items-center gap-3 flex-shrink-0">
                  <input
                    type="text"
                    value={input}
                    ref={composerRef}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a message…"
                    className="flex-1 rounded-full border border-card-border bg-surface-muted/70 px-4 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-400/60"
                  />
                  <button
                    type="submit"
                    disabled={sending || !input.trim()}
                    className="rounded-full bg-cyan-400/20 border border-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/30 disabled:opacity-60"
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </form>
                {sendError && <div className="text-center text-xs text-rose-300 pb-3 flex-shrink-0">{sendError}</div>}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-500 text-center px-6">
                Select a conversation or start a new one to begin chatting.
              </div>
            )}
        </section>
      </div>
    </div>
  )
}

function AvatarCircle({ user, size = 'base' }) {
  const dimension = size === 'small' ? 'h-8 w-8' : 'h-10 w-10'
  const displayName = user?.display_name || user?.username || shortAddress(user?.wallet)
  if (user?.avatar_url) {
    return (
      <div className={`${dimension} rounded-full overflow-hidden border border-card-border`}>
        <img src={user.avatar_url} alt={displayName} className="h-full w-full object-cover" />
      </div>
    )
  }
  return (
    <div className={`${dimension} rounded-full border border-card-border flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-black text-xs font-semibold text-white`}>
      {displayName?.slice(0, 2)?.toUpperCase() || 'SP'}
    </div>
  )
}

function formatTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function MessageBodyContent({ message, sharedPicks }) {
  if (message.body?.startsWith(PICK_PREFIX)) {
    const pickId = message.body.slice(PICK_PREFIX.length)
    const pick = sharedPicks[pickId]
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide opacity-70">Shared pick</p>
        <button
          type="button"
          onClick={() => window.open(`/pick/${pickId}`, '_blank')}
          className="w-full text-left rounded-2xl border border-card-border bg-surface-muted/40 hover:border-green-bright/50 transition-colors"
        >
          {pick?.image && (
            <div className="h-32 w-full overflow-hidden rounded-t-2xl border-b border-card-border/50">
              <img src={pick.image} alt={pick?.name || 'Shared pick'} className="h-full w-full object-cover" />
            </div>
          )}
          <div className="px-4 py-3 space-y-1">
            <div className="text-sm font-semibold text-white truncate">{pick?.name || 'View pick'}</div>
            <div className="text-[10px] text-gray-400 flex gap-2">
              <span>{pick?.category || 'General'}</span>
              <span>{(pick?.status || 'open').toUpperCase()}</span>
            </div>
            {pick?.description && (
              <p className="text-xs text-gray-300 truncate">{pick.description}</p>
            )}
          </div>
        </button>
      </div>
    )
  }
  return <p className="whitespace-pre-wrap break-words">{message.body}</p>
}

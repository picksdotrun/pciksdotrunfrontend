import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/useProfile'
import EditProfileModal from './EditProfileModal'
import TradesTable from './TradesTable'
import PicksGallery from './PicksGallery'
import InlineStat from './InlineStat'
import { formatVolumeDisplay } from '../lib/volumeFormat'

const short = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')

const Profile = () => {
  const navigate = useNavigate()
  const { authenticated, profile, walletAddress, login, updateProfile, loading: profileSaving } = useProfile()
  const [userPicks, setUserPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [copyMsg, setCopyMsg] = useState('')
  const [walletMsg, setWalletMsg] = useState('')
  const [activeTab, setActiveTab] = useState('posted')
  const [showFollowingModal, setShowFollowingModal] = useState(false)
  const [followingDetails, setFollowingDetails] = useState([])

  useEffect(() => {
    const loadUserPicks = async () => {
      if (!authenticated || !profile?.id) { setLoading(false); return }
      try {
        const { data } = await supabase
          .from('picks')
          .select('*')
          .eq('creator_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(12)
        setUserPicks(Array.isArray(data) ? data : [])
      } finally {
        setLoading(false)
      }
    }
    loadUserPicks()
  }, [authenticated, profile?.id])

  const joinedDate = useMemo(() => {
    if (!profile?.created_at) return '—'
    return new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }, [profile?.created_at])

  const followersCount = Number(profile?.followers_count ?? 0)
  const followingList = useMemo(() => parseRelationshipList(profile?.following), [profile?.following])
  const followingCount = Number(profile?.following_count ?? followingList.length)

  useEffect(() => {
    if (!showFollowingModal) {
      setFollowingDetails([])
      return
    }
    if (!followingList.length) return
    let cancelled = false
    ;(async () => {
      try {
        const ids = followingList.map((entry) => entry.id)
        const { data, error } = await supabase
          .from('users')
          .select('id, username, display_name, avatar_url, wallet')
          .in('id', ids)
        if (error) throw error
        if (!cancelled) setFollowingDetails(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('[Profile] following list load failed', err)
        if (!cancelled) setFollowingDetails([])
      }
    })()
    return () => { cancelled = true }
  }, [showFollowingModal, followingList])

  const followingRenderList = useMemo(() => {
    if (!followingList.length) return []
    const detailMap = new Map((followingDetails || []).map((u) => [u.id, u]))
    return followingList.map((entry) => {
      const detail = detailMap.get(entry.id)
      const screenName = entry.screen_name ||
        detail?.display_name ||
        detail?.username ||
        (detail?.wallet ? short(detail.wallet) : 'Picks user')
      return {
        id: entry.id,
        screen_name: screenName,
        avatar_url: detail?.avatar_url || null,
        wallet: detail?.wallet || null,
      }
    })
  }, [followingList, followingDetails])


  if (!authenticated) {
    return (
      <div className="min-h-screen bg-dark-bg text-gray-100 flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-card-bg border border-card-border rounded-3xl p-8 shadow-2xl shadow-black/50 text-center space-y-4">
          <h2 className="text-3xl font-bold text-white">Sign in to continue</h2>
          <p className="text-gray-secondary text-sm">
            Connect your wallet to view and personalize your Picks profile.
          </p>
          <button
            onClick={async () => {
              try {
                await login()
              } catch (err) {
                console.error('[Profile] login failed', err)
              }
            }}
            className="inline-flex items-center justify-center bg-green-bright text-dark-bg font-semibold rounded-full px-6 py-3 text-base hover:opacity-90 transition-opacity"
          >
            Connect wallet
          </button>
        </div>
      </div>
    )
  }

  const displayName = profile?.display_name || profile?.username || 'Picks Predictor'
  const avatarUrl = profile?.avatar_url || ''
  const picksPlaced = Number(profile?.picks_count ?? userPicks.length)
  const bio = profile?.bio || ''
  const shortAddr = short(walletAddress)
  const tradingVolumeDisplay = formatVolumeDisplay(profile?.trading_volume_wei ?? profile?.total_volume_wei)
  const winLossUserId = profile?.id || null
  const wins = Number(profile?.win_count ?? 0)
  const losses = Number(profile?.loss_count ?? 0)
  const totalTrades = wins + losses
  const winRate = totalTrades ? Math.round((wins / totalTrades) * 100) : 0
  const netWei = (BigInt(profile?.win_amount_wei ?? 0) - BigInt(profile?.loss_amount_wei ?? 0)).toString()
  const netDisplay = formatVolumeDisplay(netWei)
  const winRateHelper = totalTrades ? `${wins}W / ${losses}L • ${netDisplay}` : ''

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100">
      <div className="pt-24 pb-16 px-4">
        <div className="max-w-5xl mx-auto space-y-10">
          {/* Profile Header Card */}
          <section className="bg-card-bg/95 border border-card-border rounded-[2rem] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.7)] backdrop-blur-sm overflow-hidden">
            <div className="px-6 py-8 lg:px-10 lg:py-10 flex flex-col gap-6">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl border-2 border-green-bright/60 shadow-[0_0_30px_rgba(57,255,20,0.25)] overflow-hidden bg-surface-muted flex items-center justify-center text-2xl font-semibold">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Profile avatar" className="w-full h-full object-cover" />
                      ) : (
                        (displayName || 'SP').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">{displayName}</h1>
                          {profile?.x_handle && (
                            <a
                              href={`https://x.com/${profile.x_handle.replace(/^@/, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-card-border px-3 py-1 text-xs text-cyan-300 hover:text-white"
                            >
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">X</span>
                              <span className="font-medium">{profile.x_handle}</span>
                            </a>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-secondary">
                          <span>Joined {joinedDate}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!walletAddress) return
                              try {
                                await navigator.clipboard.writeText(walletAddress)
                                setWalletMsg('Copied!')
                                setTimeout(() => setWalletMsg(''), 1500)
                              } catch (err) {
                                console.error('[Profile] copy wallet failed', err)
                                setWalletMsg('Failed')
                                setTimeout(() => setWalletMsg(''), 1500)
                              }
                            }}
                            className="inline-flex items-center gap-1 text-xs text-gray-secondary hover:text-green-bright transition-colors"
                            title="Copy wallet address"
                          >
                            <span className="text-gray-secondary">⧉</span>
                            <span className="text-gray-200 tracking-wide">{shortAddr}</span>
                            {walletMsg && <span className="text-green-bright">{walletMsg}</span>}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="inline-flex items-center justify-center rounded-full border border-card-border text-sm px-6 py-2.5 hover:border-green-bright transition-colors min-w-[140px]"
                          onClick={async () => {
                            try {
                              const url = `${window.location.origin}/profile/${walletAddress || ''}`
                              await navigator.clipboard.writeText(url)
                              setCopyMsg('Copied!')
                              setTimeout(() => setCopyMsg(''), 1500)
                            } catch (err) {
                              console.error('[Profile] copy link failed', err)
                              setCopyMsg('Failed')
                              setTimeout(() => setCopyMsg(''), 1500)
                            }
                          }}
                        >
                          {copyMsg || 'Share profile'}
                        </button>
                        <button
                          onClick={() => setIsEditOpen(true)}
                          className="inline-flex items-center justify-center rounded-full bg-green-bright text-dark-bg font-semibold text-sm px-6 py-2.5 hover:opacity-90 transition-opacity min-w-[140px]"
                        >
                          Edit profile
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {bio && (
                  <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                    {bio}
                  </p>
                )}

                <div className="flex flex-wrap gap-5">
                  <InlineStat label="Followers" value={followersCount.toLocaleString()} />
                  <InlineStat
                    label="Following"
                    value={followingCount.toLocaleString()}
                    onClick={() => followingCount > 0 && setShowFollowingModal(true)}
                  />
                  <InlineStat label="Picks placed" value={picksPlaced.toLocaleString()} />
                  <InlineStat label="Win rate" value={`${winRate}%`} helper={winRateHelper} onClick={() => setActiveTab('placed')} />
                  <InlineStat label="Trading volume" value={tradingVolumeDisplay} helper="Lifetime BNB traded" onClick={() => setActiveTab('placed')} />
                </div>
              </div>
            </div>
          </section>

          {/* Activity Section */}
          <section className="bg-card-bg/80 border border-card-border rounded-[1.75rem] px-8 py-8 lg:px-10 lg:py-10 shadow-[0_30px_100px_-40px_rgba(0,0,0,0.7)] space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-white tracking-tight">Prediction overview</h2>
              <nav className="flex items-center gap-6 text-sm font-semibold">
                {[
                  { id: 'posted', label: 'Posted predictions' },
                  { id: 'placed', label: 'Placed predictions' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`relative pb-2 transition-colors ${
                      activeTab === id ? 'text-cyan-300' : 'text-gray-secondary hover:text-gray-100'
                    }`}
                  >
                    {label}
                    <span
                      className={`absolute -bottom-1 left-0 right-0 h-[3px] rounded-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-400 shadow-[0_0_12px_rgba(110,231,183,0.55)] transition-opacity ${
                        activeTab === id ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  </button>
                ))}
              </nav>
            </div>

            <div className="mt-4">
              <TabContent
                activeTab={activeTab}
                loading={loading}
                userPicks={userPicks}
                userId={winLossUserId}
              />
            </div>
          </section>

        </div>
      </div>
      {showFollowingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl bg-card-bg border border-card-border shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between px-5 py-4 border-b border-card-border/60">
              <div>
                <h3 className="text-lg font-semibold text-white">Following</h3>
                <p className="text-xs text-gray-400">{followingCount.toLocaleString()} accounts</p>
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-white text-xl leading-none"
                onClick={() => setShowFollowingModal(false)}
              >
                ×
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-3">
              {followingRenderList.length === 0 ? (
                <p className="text-sm text-gray-400 text-center">Not following anyone yet.</p>
              ) : (
                followingRenderList.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setShowFollowingModal(false)
                      if (entry.wallet) navigate(`/profile/${entry.wallet}`)
                    }}
                    className="w-full flex items-center gap-3 rounded-xl border border-card-border px-3 py-2 text-left hover:border-green-bright/50 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-full border border-card-border overflow-hidden bg-surface-muted/50 flex items-center justify-center text-sm font-semibold text-white">
                      {entry.avatar_url ? (
                        <img src={entry.avatar_url} alt={entry.screen_name} className="h-full w-full object-cover" />
                      ) : (
                        entry.screen_name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{entry.screen_name}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isEditOpen && (
        <EditProfileModal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          profile={profile}
          onSave={updateProfile}
          saving={profileSaving}
        />
      )}
    </div>
  )
}

function TabContent({ activeTab, loading, userPicks, userId }) {
  if (loading) {
    return (
      <div className="grid gap-4">
        {[...Array(3)].map((_, idx) => (
          <div key={idx} className="animate-pulse bg-card/60 border border-card-border/60 rounded-2xl h-24" />
        ))}
      </div>
    )
  }

  if (activeTab === 'posted') {
    return <PicksGallery picks={userPicks} emptyLabel="No posted predictions yet." />
  }

  return (
    <TradesTable
      mode="user"
      filterId={userId}
      title="Placed predictions"
      emptyMessage="No completed trades yet. Start trading to populate this history."
      maxHeight="420px"
    />
  )
}
function parseRelationshipList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export default Profile

import { useProfile } from '../lib/useProfile'
import { useMemo, useRef, useState, useLayoutEffect, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HOME_CATEGORY_FILTERS, DEFAULT_CATEGORY_SLUG, resolveCategorySlug } from '../lib/categoryFilters'

const Header = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { walletAddress, profile, login, logout, authenticated } = useProfile()
  const userWallet = walletAddress
  const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—')

  const avatarColor = useMemo(() => {
    const w = profile?.wallet || userWallet || ''
    if (!w) return '#39ff14'
    let hash = 0
    for (let i = 0; i < w.length; i++) hash = (hash * 31 + w.charCodeAt(i)) >>> 0
    const hue = hash % 360
    return `hsl(${hue} 85% 55%)`
  }, [profile?.wallet, userWallet])
  const headerRef = useRef(null)
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const apply = () => {
      const h = el.offsetHeight || 64
      document.documentElement.style.setProperty('--header-h', `${h}px`)
    }
    apply()
    let ro = null
    if (window.ResizeObserver) {
      ro = new ResizeObserver(apply)
      ro.observe(el)
    } else {
      window.addEventListener('resize', apply)
    }
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', apply) }
  }, [])

  const [showHow, setShowHow] = useState(false)
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const isPickPage = location?.pathname?.startsWith('/pick')
  const activeCategory = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '')
      return resolveCategorySlug(params.get('category'))
    } catch {
      return DEFAULT_CATEGORY_SLUG
    }
  }, [location.search])

  const handleCategoryClick = (slug) => {
    const targetSlug = slug || DEFAULT_CATEGORY_SLUG
    const params = new URLSearchParams(location.search || '')
    if (targetSlug === DEFAULT_CATEGORY_SLUG) {
      params.delete('category')
    } else {
      params.set('category', targetSlug)
    }
    const nextSearch = params.toString()
    const pathname = '/home'
    const suffix = nextSearch ? `?${nextSearch}` : ''
    const nextUrl = `${pathname}${suffix}`
    if (location.pathname === pathname && location.search === suffix) return
    navigate(nextUrl)
  }

  useEffect(() => {
    setShowMobileFilters(false)
  }, [location.pathname])

  return (
    <header ref={headerRef} className="fixed top-0 left-0 right-0 z-40 bg-card-bg/95 border-b border-card-border backdrop-blur">
      {/* Row 1: logo + login */}
      <div className="px-4 py-2 flex items-center justify-between gap-2 overflow-visible">
        <img src="/brand_logo.png" alt="Logo" className="h-12 w-auto object-contain cursor-pointer transform-gpu origin-left scale-[2.5]" onClick={() => navigate('/home')} />
        <div className="flex items-center gap-3">
          {userWallet && profile && (
            <div className="flex items-center gap-2 text-gray-100 text-sm">
              <button
                onClick={() => navigate('/profile')}
                className="relative group"
                title="View profile"
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="avatar"
                    className="w-9 h-9 rounded-full object-cover border border-card-border group-hover:border-green-bright transition-colors"
                  />
                ) : (
                  <span
                    className="inline-block w-9 h-9 rounded-full border border-card-border group-hover:border-green-bright transition-colors"
                    style={{ backgroundColor: avatarColor }}
                  />
                )}
              </button>
              <div className="flex flex-col leading-tight">
                <button
                  onClick={() => navigate('/profile')}
                  className="text-left font-semibold text-gray-50 hover:text-green-bright transition-colors"
                >
                  {profile?.username || short(userWallet)}
                </button>
                <div className="flex items-center gap-1 text-xs text-gray-secondary">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(userWallet)
                      } catch (err) {
                        console.error('[Header] Failed to copy wallet', err)
                      }
                    }}
                    className="text-gray-secondary hover:text-green-bright transition-colors"
                    title="Copy address"
                  >
                    ⧉
                  </button>
                  <span className="text-gray-300">{short(userWallet)}</span>
                </div>
              </div>
            </div>
          )}
          {!authenticated ? (
            <button
              onClick={async () => {
                try {
                  await login()
                } catch (e) {
                  console.error('[Header] login failed', e)
                  alert(e?.message || 'Failed to authenticate (check MetaMask)')
                }
              }}
              className="inline-flex items-center justify-center bg-green-bright text-white rounded-md px-3 py-2 text-sm transition-opacity hover:opacity-90"
            >
              Log in
            </button>
          ) : (
            <button
              onClick={async () => { try { await logout() } catch {} }}
              className="inline-flex items-center justify-center border border-card-border hover:border-green-bright text-gray-100 rounded-md px-3 py-2 text-sm transition-colors"
            >
              Log out
            </button>
          )}
        </div>
      </div>

      {/* Row 2: centered search + How it works toggle */}
      <div className="px-4 pb-2 flex items-center justify-center gap-4">
        <div className="relative w-full max-w-2xl">
          <input
            type="text"
            className="w-full bg-surface-muted border border-card-border/70 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-100 placeholder-gray-secondary focus:outline-none focus:border-green-bright focus:ring-1 focus:ring-green-bright/40"
            placeholder="Search Picks"
            onKeyDown={(e) => { if (e.key === 'Enter') navigate('/home') }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button
          type="button"
          onMouseDown={(e)=>e.preventDefault()}
          onClick={() => setShowHow(v => !v)}
          className="hidden md:inline-flex items-center gap-1 text-green-bright hover:opacity-80 text-sm focus:outline-none"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth="2" />
            <path d="M12 16v-4" strokeWidth="2" />
            <circle cx="12" cy="8" r="1" fill="currentColor" />
          </svg>
          How it works
        </button>
      </div>

      {/* Row 3: categories (buttons) — hidden on pick page */}
      {!isPickPage && (
        <div className="px-4 pb-2 space-y-2">
          <div className="flex items-center justify-end md:hidden">
            <button
              type="button"
              onClick={() => setShowMobileFilters((v) => !v)}
              aria-label="Toggle filters"
              aria-expanded={showMobileFilters}
              className="inline-flex items-center gap-2 rounded-full border border-card-border/70 bg-surface-muted/70 px-3 py-1.5 text-xs uppercase tracking-[0.3em] text-gray-100"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M4 6h16M7 12h10M10 18h4" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Filters
            </button>
          </div>
          <div className={`${showMobileFilters ? 'block' : 'hidden'} md:block`}>
            <div className="flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:overflow-visible md:justify-center">
              {HOME_CATEGORY_FILTERS.map(({ label, slug }) => {
                const isActive = activeCategory === slug
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => handleCategoryClick(slug)}
                    aria-pressed={isActive}
                    className={`whitespace-nowrap px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      isActive
                        ? 'border-green-bright/80 bg-green-bright/15 text-green-bright'
                        : 'border-card-border/70 bg-surface-muted/60 hover:bg-surface-muted text-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: How it works */}
      {showHow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowHow(false)} />
          <div className="relative z-10 w-[92%] max-w-xl bg-card-bg border border-card-border rounded-xl p-5 shadow-lg shadow-black/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-white font-semibold">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="2" />
                  <path d="M12 16v-4" strokeWidth="2" />
                  <circle cx="12" cy="8" r="1" fill="currentColor" />
                </svg>
                How it works
              </div>
              <button onClick={() => setShowHow(false)} className="text-gray-secondary hover:text-white transition-colors">✕</button>
            </div>
            <p className="text-gray-secondary text-sm">
              Each pick launches a BNB contract with twin vaults. Depositing into the Yes vault mints Yes shares; depositing into the No vault mints No shares. When the market settles, only the winning side can redeem shares back into BNB.
            </p>
          </div>
        </div>
      )}
      </header>
  )
}

export default Header

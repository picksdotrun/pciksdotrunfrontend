import { useLocation, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/useProfile'

const iconClass = (active) => (active ? 'text-white' : 'text-white/60')

const NavIconButton = ({ label, active, onClick, IconComponent }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="flex flex-col items-center gap-1 py-2"
  >
    <span className="sr-only">{label}</span>
    <span
      className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
        active ? 'border-white/40 bg-white/10' : 'border-white/10 bg-transparent'
      }`}
    >
      <IconComponent className={`h-6 w-6 ${iconClass(active)}`} />
    </span>
  </button>
)

export default function BottomBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const avatarUrl = profile?.avatar_url
  const profileInitials = (profile?.display_name || profile?.username || '').slice(0, 2).toUpperCase() || 'SP'

  const isActive = (path) => location.pathname.startsWith(path)

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#050506]/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-xl grid-cols-5 items-center gap-2 px-4 py-3">
        <NavIconButton
          label="Leaderboard"
          active={isActive('/leaderboard')}
          onClick={() => navigate('/leaderboard')}
          IconComponent={({ className }) => (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
              <path d="M8 21V10M16 21V6M12 21V14" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        />

        <NavIconButton
          label="Explore"
          active={isActive('/explore')}
          onClick={() => navigate('/explore')}
          IconComponent={({ className }) => (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
              <circle cx="11" cy="11" r="6" strokeWidth="2" />
              <path d="M21 21l-4.5-4.5" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        />

        <button
          type="button"
          aria-label="Create prediction"
          onClick={() => navigate('/home?new=1')}
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0ea5ff] text-3xl font-semibold text-white shadow-[0_0_25px_rgba(14,165,255,0.55)] hover:bg-[#08b0ff] transition"
        >
          +
        </button>

        <NavIconButton
          label="Messages"
          active={isActive('/messages')}
          onClick={() => navigate('/messages')}
          IconComponent={({ className }) => (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
              <path
                d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        />

        <NavIconButton
          label="Profile"
          active={location.pathname === '/profile'}
          onClick={() => navigate('/profile')}
          IconComponent={({ className }) =>
            avatarUrl ? (
              <img src={avatarUrl} alt="Profile" className={`h-6 w-6 rounded-full object-cover ${className}`} />
            ) : (
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white ${className}`}>
                {profileInitials}
              </span>
            )
          }
        />
      </div>
    </div>
  )
}

import { NavLink, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/useProfile'

export default function Sidebar() {
  const navigate = useNavigate()
  const { walletAddress: wallet } = useProfile()

  const items = [
    { name: 'Home', path: '/home', icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-10.5z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ) },
    { name: 'Explore', path: '/explore', icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7" strokeWidth="2"/><path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round"/></svg>
    ) },
    { name: 'Leaderboard', path: '/leaderboard', icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21V10M16 21V6M12 21V14" strokeWidth="2" strokeLinecap="round"/></svg>
    ) },
    { name: 'Advanced', path: '/grok', icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12h16M12 4v16" strokeWidth="2" strokeLinecap="round"/></svg>
    ) },
    { name: 'Claim rewards', path: '/claimrewards', icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M12 5v14" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 9h16" strokeWidth="2" strokeLinecap="round" />
        <path d="M5 9v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.5 5c-1.5 0-2.5-.8-2.5-2s1-2 2.5-2 2.5.8 2.5 2-1 2-2.5 2Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14.5 5c-1.5 0-2.5-.8-2.5-2s1-2 2.5-2 2.5.8 2.5 2-1 2-2.5 2Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) },
  ]
  if (wallet) {
    items.push({
      name: 'Direct messages',
      path: '/messages',
      icon: (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    })
    items.push({
      name: 'Profile',
      path: '/profile',
      icon: (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4" strokeWidth="2"/><path d="M4 21c2-4 6-6 8-6s6 2 8 6" strokeWidth="2"/></svg>
      ),
    })
  }
  items.push({
    name: 'Settings',
    path: '/settings',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path d="M12 8v8M8 12h8" strokeWidth="2" strokeLinecap="round"/></svg>
    ),
  })

  return (
    <div className="hidden md:flex fixed left-0 bg-card-bg/90 border-r border-card-border flex-col z-50 w-20 lg:w-64 overflow-x-hidden backdrop-blur"
         style={{ top: 'var(--header-h, 4rem)', height: 'calc(100vh - var(--header-h, 4rem))' }}>
      <nav className="px-2 overflow-y-auto overflow-x-hidden">
        <div className="h-1/2 mt-2 lg:mt-4 flex flex-col justify-between">
          {items.map((item, idx) => (
            <div key={item.name}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `group relative flex items-center gap-4 px-2 lg:px-4 py-3 rounded-full transition-colors duration-200 ${
                    isActive ? 'bg-green-bright/15 text-green-bright font-semibold' : 'text-gray-200 hover:bg-surface-muted'
                  } md:justify-center lg:justify-start`}
              >
                <span className="text-gray-400">{item.icon}</span>
                {/* label appears only on hover */}
                <span className="hidden group-hover:inline lg:hidden absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-surface-muted text-white text-xs px-2 py-1 rounded border border-card-border/60 shadow-lg shadow-black/30">
                  {item.name}
                </span>
                <span className="hidden lg:inline text-sm">{item.name}</span>
              </NavLink>
              {idx === 1 && (
                <div className="p-2 lg:p-4">
                  <button
                    onClick={() => navigate('/home?new=1')}
                    className="group w-full rounded-full bg-[#26c9ff] hover:bg-[#45e2ff] text-white shadow-[0_0_24px_rgba(38,201,255,0.65)] hover:shadow-[0_0_32px_rgba(69,226,255,0.75)] transition-all duration-200 py-3 font-semibold text-base flex items-center justify-center"
                  >
                    <span className="lg:hidden text-xl leading-none">+</span>
                    <span className="hidden lg:inline">Create prediction</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </nav>
      {/* optional user block could go here */}
    </div>
  )
}

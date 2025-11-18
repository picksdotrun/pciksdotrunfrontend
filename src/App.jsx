import { Routes, Route, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import BottomBar from './components/BottomBar'
import Home from './components/Home'
import Profile from './components/Profile'
// import GrokTestPage from './components/GrokTestPage'
import AdvancedPanels from './components/AdvancedPanels'
import Explore from './components/Explore'
import AdminProps from './components/AdminProps'
import AdminUFC from './components/AdminUFC'
import AdminPolitics from './components/AdminPolitics'
import AdminFutureProps from './components/AdminFutureProps'
import Leaderboard from './components/Leaderboard'
import PublicProfile from './components/PublicProfile'
import PickPage from './pages/PickPage'
import AdminBackend from './pages/AdminBackend'
import Settings from './pages/Settings'
import Landing from './pages/Landing'
import ClaimRewards from './pages/ClaimRewards'
import XCallback from './pages/XCallback'
import ProfileSetupDialog from './components/ProfileSetupDialog.jsx'
import { useProfile } from './lib/useProfile'
import Messages from './pages/Messages'

function App() {
  const location = useLocation()
  const { needsProfile } = useProfile()
  const hideChrome = location.pathname === '/'
  const containerStyle = hideChrome ? undefined : { paddingTop: 'var(--header-h, 4rem)' }
  const containerClass = hideChrome ? '' : 'pb-28 md:pb-0 md:pl-20 lg:pl-64'

  return (
    <>
      <ProfileSetupDialog open={needsProfile} />
      {!hideChrome && <Header />}
      {/* MetaMask auth is user-initiated via Header connect button */}
      {!hideChrome && <Sidebar />}
      {!hideChrome && <BottomBar />}
      <div style={containerStyle} className={containerClass}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/home" element={<Home />} />
          <Route path="/app" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          {/* Authenticated user's own profile */}
          <Route path="/profile" element={<Profile />} />
          {/* Public profile by wallet address */}
          <Route path="/profile/:wallet" element={<PublicProfile />} />
          {/* Advanced page with draggable panels */}
          <Route path="/grok" element={<AdvancedPanels />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/pick/:id" element={<PickPage />} />
          <Route path="/claimrewards" element={<ClaimRewards />} />
          <Route path="/x/callback" element={<XCallback />} />
          <Route path="/messages" element={<Messages />} />
          {/* Admin: Sports props structured testing */}
          <Route path="/admin/props" element={<AdminProps />} />
          <Route path="/admin/props-ufc" element={<AdminUFC />} />
          <Route path="/admin/props-politics" element={<AdminPolitics />} />
          <Route path="/admin/props-future" element={<AdminFutureProps />} />
          {/* Backend admin to deploy EVM markets */}
          <Route path="/mein/arbeit" element={<AdminBackend />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </>
  )
}

export default App
 

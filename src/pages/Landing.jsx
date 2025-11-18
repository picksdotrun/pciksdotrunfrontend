import { Link } from 'react-router-dom'

const navLinks = []

export default function Landing() {
const previewPicks = [
    {
      id: 1,
      title: 'How many yards per carry will Mahomes average vs Raiders?',
      stat: 'O/U 4.8',
      time: 'LIVE · 12m left',
      category: 'Sports',
      payout: '148.00',
      yesLabel: 'Yes',
      noLabel: 'No',
    },
    {
      id: 2,
      title: 'Will Grok break the story before cable news?',
      stat: 'YES vs NO',
      time: 'Trending · 2h left',
      category: 'Media',
      payout: '96.25',
      yesLabel: 'Yes',
      noLabel: 'No',
    },
    {
      id: 3,
      title: 'Will Trump mention “Biden” 15+ times tonight?',
      stat: 'Target: 15 mentions',
      time: 'Ends in 6h',
      category: 'Politics',
      payout: '212.40',
      yesLabel: 'Yes',
      noLabel: 'No',
  },
]
const sidebarItems = [
  {
    label: 'Home',
    accent: true,
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-10.5z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Explore',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="11" cy="11" r="7" strokeWidth="2" />
        <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Leaderboard',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M8 21V10M16 21V6M12 21V14" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Advanced',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M4 12h16M12 4v16" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Claim rewards',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M5 9v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 9h16" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 5v4" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Direct messages',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Profile',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="8" r="4" strokeWidth="2" />
        <path d="M4 21c2-4 6-6 8-6s6 2 8 6" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Settings',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <path d="M12 8v8M8 12h8" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
]
const categoryTabs = ['Trending', 'New', 'All', 'Politics', 'Sports', 'Culture', 'Crypto', 'Climate', 'Economics', 'Mentions']
const phoneHighlights = [
  {
    id: 'instant',
    kicker: 'Instant launch',
    heading: 'Phone-first trading for breaking stories',
    body: 'Drop a pick the moment a headline hits. Every viewer sees real odds, real liquidity, and live price swings.',
    alignment: 'left',
    cta: true,
  },
  {
    id: 'social',
    kicker: 'Creator reach',
    heading: 'Shareable phones slot into every timeline',
    body: 'Picks render like Stories—tap Yes/No, remix the market, and bring the receipts back to your audience without leaving the feed.',
    alignment: 'right',
  },
  {
    id: 'liquidity',
    kicker: 'Liquidity proof',
    heading: 'Every pick carries payouts, holders, and activity',
    body: 'The same device shell powers every module so traders instantly understand the odds, size, and urgency before they ape in.',
    alignment: 'left',
  },
]
  const heroBody =
    'picks is the first prediction market that pays you to create predictions. Make your first prediction now.'
  const DeviceMockup = () => (
    <div className="device-frame">
      <div className="device-notch">
        <span />
      </div>
      <div className="device-screen">
        <div className="device-feed device-feed-single">
          <header className="device-feed-header">
            <span className="device-feed-title">Explore Picks</span>
            <button type="button" className="device-feed-cta">Create</button>
          </header>
          <div className="device-feed-body">
            {previewPicks.map((pick) => (
              <article key={pick.id} className="device-card">
                <div className="device-card-tag">{pick.category}</div>
                <h4 className="device-card-title">{pick.title}</h4>
                <div className="device-card-stat">
                  <span>{pick.stat}</span>
                  <span>{pick.time}</span>
                </div>
                <div className="device-card-payout">Potential payout: ${pick.payout} USD</div>
                <div className="device-card-actions">
                  <button type="button" className="device-card-btn">Yes</button>
                  <button type="button" className="device-card-btn device-card-btn-outline">No</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
      <div className="device-homebar" />
    </div>
  )
  return (
    <div className="min-h-screen bg-background text-foreground">
      <section id="hero" className="hero-section relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="w-full h-full">
            <div className="relative w-full h-[520px] md:h-[600px] max-h-[72vh] translate-y-12 md:translate-y-10">
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/55 to-black/80" />
              <div className="absolute inset-0">
                <video
                  className="w-full h-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                >
                  <source src="/hero.mp4" type="video/mp4" />
                </video>
              </div>
            </div>
          </div>
        </div>

        <header className="relative z-50 w-full border-b border-white/15 bg-[#040406] shadow-[0_10px_30px_rgba(0,0,0,0.55)] outline outline-1 outline-white/5">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-4 px-4 py-2 md:flex-nowrap md:gap-6 md:px-6 md:py-3">
            <div className="flex flex-shrink-0 items-center">
              <img
                src="/brand_logo.png"
                alt="Picks logo"
                className="block h-12 w-auto md:h-16 origin-left scale-[1.9] md:scale-[2.3] object-contain drop-shadow-[0_25px_55px_rgba(0,0,0,0.55)]"
              />
            </div>
            <nav className="flex flex-1 flex-wrap items-center gap-3 text-[0.6rem] font-semibold text-white/80 uppercase tracking-[0.25em] md:justify-center md:gap-6 md:text-xs">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <a
                href="https://docs.picks.run"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border border-white/25 px-4 py-2 text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-white/80 hover:bg-white/10 md:text-xs"
              >
                Docs
              </a>
              <Link
                to="/home"
                className="inline-flex items-center justify-center rounded-xl bg-[#0ea5ff] hover:bg-[#08b0ff] px-4 py-2 text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-white shadow-[0_0_15px_rgba(14,165,255,0.6)] md:text-xs"
              >
                Go to app
              </Link>
            </div>
          </div>
        </header>

        <div className="relative z-40 max-w-6xl mx-auto px-6 pt-6 md:pt-12 pb-4 md:pb-10">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-center">
            <div className="flex-1 text-left">
              <h1 className="mt-2 text-left text-4xl font-black tracking-tight text-white leading-tight md:text-6xl lg:text-7xl">
                Predict anything and everything.
              </h1>
              <p className="mt-6 text-lg text-white/80 md:text-xl">
                {heroBody}
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-6">
                <Link
                  to="/home"
                  className="inline-flex items-center justify-center rounded-3xl bg-[#0ea5ff] px-10 py-4 text-xl font-semibold uppercase tracking-[0.25em] text-white shadow-[0_0_25px_rgba(14,165,255,0.65)] hover:bg-[#08b0ff] transition"
                >
                  Enter the app
                </Link>
                <a
                  href="https://x.com/picksdotrun"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Follow Picks on X"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-5 text-white/80 transition hover:bg-white/10"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-7 w-7"
                  >
                    <path
                      fill="currentColor"
                      d="M3.5 0H9l4.5 6.5L18 0h6l-7.5 9.2L24 24h-5.5l-4.7-6.9L9 24H3.5l7.7-9.5L3.5 0Z"
                    />
                  </svg>
                </a>
              </div>
            </div>
            <div className="flex-1 w-full">
              <div className="device-frame">
                <div className="device-notch">
                  <span />
                </div>
                <div className="device-screen">
                  <div className="device-feed device-feed-single">
                    <header className="device-feed-header">
                      <span className="device-feed-title">Explore Picks</span>
                      <button type="button" className="device-feed-cta">Create</button>
                    </header>
                    <div className="device-feed-body">
                      {previewPicks.map((pick) => (
                        <article key={pick.id} className="device-card">
                          <div className="device-card-tag">{pick.category}</div>
                          <h4 className="device-card-title">{pick.title}</h4>
                          <div className="device-card-stat">
                            <span>{pick.stat}</span>
                            <span>{pick.time}</span>
                          </div>
                          <div className="device-card-payout">Potential payout: ${pick.payout} USD</div>
                          <div className="device-card-actions">
                            <button type="button" className="device-card-btn">Yes</button>
                            <button type="button" className="device-card-btn device-card-btn-outline">No</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="device-homebar" />
              </div>
            </div>
          </div>
        </div>

        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[1200px] h-[1200px] rounded-full bg-cyan-500/10 blur-3xl -z-20" />
      </section>

      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-6 space-y-16">
          {phoneHighlights.filter((highlight, idx) => idx < phoneHighlights.length - 1).map((highlight) => {
            const isLeft = highlight.alignment === 'left'
            return (
              <div
                key={highlight.id}
                className={`flex flex-col items-center gap-10 ${isLeft ? 'lg:flex-row' : 'lg:flex-row-reverse'}`}
              >
                <div className="flex-1 w-full max-w-xl">
                  <DeviceMockup />
                </div>
                <div className="flex-1 w-full">
                  <div className={`max-w-lg ${isLeft ? 'lg:text-left' : 'lg:text-right'} text-center lg:text-inherit space-y-4`}>
                    <p className="text-xs uppercase tracking-[0.4em] text-white/60">{highlight.kicker}</p>
                    <h3 className="text-3xl md:text-4xl font-black text-white">{highlight.heading}</h3>
                    <p className="text-base md:text-lg text-white/70">{highlight.body}</p>
                    {highlight.cta && (
                      <div className={`${isLeft ? 'lg:justify-start' : 'lg:justify-end'} flex justify-center pt-2`}>
                        <Link
                          to="/home"
                          className="inline-flex items-center justify-center rounded-3xl bg-[#0ea5ff] px-8 py-3 text-base font-semibold uppercase tracking-[0.25em] text-white shadow-[0_0_25px_rgba(14,165,255,0.55)] hover:bg-[#08b0ff] transition"
                        >
                          Enter the app
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section id="leaderboard" className="py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.6em] text-white/60">Leaderboard</p>
          <h3 className="text-3xl md:text-4xl font-extrabold">Climb the social prediction leaderboard</h3>
          <p className="mt-4 text-muted-foreground text-base md:text-lg">
            Every pick powers your rank. Track streaks, yield, and total liquidity as you compete with friends and pro curators.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Active predictors', value: '48,210' },
              { label: 'Avg. ROI (Top 10)', value: '212%' },
              { label: 'Weekly markets', value: '1,840' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-5">
                <p className="text-2xl font-semibold text-white">{stat.value}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.3em] text-white/60">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="partners" className="py-10 md:py-14">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 items-center justify-items-center">
            {[
              { name: 'Seedify', src: '/seedifylogo.png.png' },
              { name: 'BNB', src: '/bnb.png' },
              { name: 'Polymarket', src: '/polymarket.png' },
              { name: 'Grok', src: '/grok.png' },
            ].map((logo) => (
              <div
                key={logo.name}
                className="w-28 h-16 sm:w-32 sm:h-20 flex items-center justify-center bg-surface-muted/60 border border-border/50 rounded-2xl"
              >
                <img src={logo.src} alt={logo.name} className="max-h-14 max-w-[85%] object-contain" />
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}

# picks.run — Frontend (SolPicks)

picks.run is the first prediction-market social platform aimed at retail consumers who may know little or nothing about crypto. Our goal is to provide a frictionless onboarding ramp where anyone can create or trade a prediction in seconds and earn money while doing it. Every feature in this repo is designed to feel familiar to mainstream users (Instagram-style feeds, social interactions, one-click sharing to X) while still settling markets trustlessly on BNB.

## Product pillars

1. **Create predictions about anything** – from “Predict the rest of this image” to hyper-specific sports, politics, or pop-culture stats. The UI walks users through drafting a post while Grok + third-party APIs moderate and determine settlement data sources in real time.
2. **Attention flywheel** – every pick posted in-app is simultaneously tweeted as an X Poll. Anyone can reply “YES” or “NO” without even signing up, then return to picks.run/claimrewards to collect free starter shares. This giveaway mechanic is our “invite your friend, get $5” moment.
3. **Social layer familiar to Web2 users** – follows, DMs, likes, comments, reposts, Explore feeds, and creators earning platform fees (200–300 bps per trade, with a cut automatically routed to the pick’s author).
4. **Frictionless onboarding** – MetaMask or Privy wallets, MoonPay debit on-ramp, and edge flows that hide gas from newcomers (the prize wallet buys and transfers 0.01 BNB of shares during reward claims).

## Repo tour

| Path | Purpose |
| --- | --- |
| `src/components/` | Core UI: feed, pick detail, claim modal, profile, DMs, leaderboards. |
| `src/pages/ClaimRewards.jsx` | Attention flywheel landing page (connect X, verify reply, trigger edge function to buy+transfer shares). |
| `src/lib/launchTokens.js` | Frontend helper that calls the backend edge function to deploy a BNB market per pick. |
| `src/lib/useProfile.js` | Privy/Supabase profile hook for wallet auth, handles Grok + claim gating. |
| `src/lib/categoryFilters.js` | Source of truth for the Explore/Home filter tabs (Trending, Sports, Crypto, etc.). |
| `netlify/functions/*` | UI-adjacent serverless functions (Grok proxy, pick manager, follow requests, etc.). |
| `supabase/` | Migrations and references for public tables (picks, users, trades). |

## Key experiences

- **Explore / Home** (`src/components/Home.jsx`, `src/components/Explore.jsx`): zora/Instagram style feed with filters (Trending, Politics, Sports...). Each card deep-links to `/pick/:id`.
- **Pick creation** (`src/components/AddPlayerModal.jsx`): collects rules, description, optional media; once submitted it calls `launchEvmMarket` to mint YES/NO share tokens and store addresses back in Supabase.
- **Pick detail & trading** (`src/components/PlayerCard.jsx`, `src/components/EvmTradePanel.jsx`): shows live odds, vault balances, share purchase controls, and resolution metadata.
- **Claim rewards** (`src/pages/ClaimRewards.jsx`): handles X OAuth, eligibility checks via Supabase Edge function `claim-attention-eligibility`, and triggers `claim-reward-shares` to buy 0.01 BNB of the winning side using the prize wallet before transferring shares to the winner’s Privy wallet.
- **Social + messaging** (`src/pages/Messages.jsx`, profile components): follow/follower graphs, likes, reposts, creator earnings, and DM threads.

## Architecture overview

- **UI stack:** React 18 + Vite, Tailwind, Zustand context wrappers (`NowProvider`) for “live” timers.
- **Authentication:** Privy for wallets + Supabase user rows; optional MetaMask fallback for dev environments.
- **Data layer:** Supabase Postgres (picks, trades, users, follower graph). Realtime channels push pick updates to the feed.
- **Edge/Serverless:** Supabase Edge Functions for claim checks, prize share purchases, pick settlement sweeps; Netlify Functions for Grok proxy, follow manager, metrics, wallet helpers.
- **Blockchain:** Each pick deploys a custom BNB vault contract (native YES/NO shares). The frontend never holds private keys; all writes go through backend/edge functions using the deployer/prize wallets.

## Edge & backend touchpoints

| Endpoint | Location | Description |
| --- | --- | --- |
| `/functions/v1/claim-attention-eligibility` | Supabase Edge | Given a pick/tweet/user, checks the X poll replies and returns eligibility + parsed choice. |
| `/functions/v1/claim-reward-shares` | Supabase Edge | Prize wallet buys 0.01 BNB of YES or NO on the pick’s market and transfers shares to the user’s Privy wallet; returns both tx hashes. |
| `/functions/v1/pick-manager` | Supabase Edge | Sweeps expired picks and triggers backend resolution (so the UI can stay stateless). |
| `/functions/v1/creator-fee-tracker` | Supabase Edge | Indexes trades via ANKR and updates volume/fees. |
| `/.netlify/functions/grok*` | Netlify | Proxies Grok (xAI) requests and handles moderation/oracle lookups for new picks. |

See the [companion backend README](https://github.com/picksdotrun/picksdotrunbackend) for contract and deployment details.

## Local development

1. `pnpm install` (or `npm install`).
2. Copy `.env.example` to `.env` and fill:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   - `VITE_PRIVY_APP_ID`
   - `VITE_BACKEND_BASE_URL`
   - `VITE_GROK_FUNCTION_PATH` (defaults to `/.netlify/functions/grok`)
3. Run Supabase locally if you need database access or point to the hosted instance.
4. `npm run dev` starts Vite + the Netlify function proxy (Netlify CLI recommended for local functions).
5. Optional: `npm run build && npm run preview` for production bundle smoke tests.

### Testing checklist for judges

- `npm run lint`: ESLint/Tailwind sanity checks.
- `npm run test:ui` (if Playwright/Cypress configured) to smoke-test the claim modal, pick creation, and Grok chatboxes.
- Manual QA flows:
  1. Create a new pick via the floating “New” button.
  2. Confirm the auto-posted X poll appears (mock via staging if necessary).
  3. Use `/claimrewards` to reply + claim shares; verify BscScan links render.
  4. DM yourself from a second wallet to showcase the social layer.

## Deployment notes

- Production build targets Netlify (static assets) backed by Supabase Edge Functions and a Railway backend service for contract administration.
- Edge functions (`claim-*`, `pick-manager`, `creator-fee-tracker`) run inside Supabase; configure secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANKR_API_KEY`, `PRIZE_PRIVATE_KEY`, etc.) via the Supabase dashboard.
- The prize/deployer wallet must stay funded with BNB so “Claim shares” can purchase and transfer rewards on demand.
- For hackathon judging, clone the companion backend repo, set the environment variables documented below, and the UI will wire up automatically once `VITE_BACKEND_BASE_URL` points to your instance.

---

Questions? DM @picksdotrun on X or open an issue. Thank you for reviewing picks.run! 

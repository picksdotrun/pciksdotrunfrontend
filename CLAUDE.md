# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start Vite dev server at http://localhost:5173 with HMR
- `npm run build` - Build production bundle to dist/
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint on the codebase

### Supabase Edge Functions
Deploy functions (from repo root):
```bash
supabase functions deploy <function-name> --no-verify-jwt
```

Key functions:
- `launch-pair` - Launches UNDER/OVER token pairs for predictions
- `claim-fees` - Claims creator fees from pools
- `claim-all` - Batch claims all fees (cron job)
- `under`/`over` - Updates metrics for predictions
- `swap` - Handles token swapping

### Testing
Run individual edge functions locally:
```bash
supabase functions invoke <function-name> --no-verify-jwt --body '{"key":"value"}'
```

## Architecture

### Frontend (React + Vite)
The app is a prediction market platform on Solana where users can bet on outcomes by trading UNDER/OVER tokens.

**Core Flow:**
1. Users create predictions (e.g., "Team X will score over 100 points")
2. Two tokens are launched on Solana: UNDER and OVER
3. Users swap SOL for their chosen position token
4. When event concludes, winners claim all accumulated trading fees

**Key Components:**
- `src/App.jsx` - Main app orchestrator, manages prediction state and real-time updates
- `src/components/PlayerGrid.jsx` - Displays prediction cards in a grid
- `src/components/DetailPanel.jsx` - Side panel for swapping tokens and viewing details
- `src/components/AddPlayerModal.jsx` - Modal for creating new predictions

### Backend Services

**Supabase Database:**
- `picks` table - Stores predictions with tokens, metrics, expiration
- Real-time subscriptions update UI when metrics change
- RLS policies allow anonymous read/insert

**Token Launch Process:**
1. Frontend calls `launchTokens.js` which invokes `launch-pair` edge function
2. Edge function calls Inkwell backend to create tokens via Railway API
3. Two Meteora bonding curve pools are created (UNDER/OVER)
4. Mints and pool addresses stored in database

**Swap Integration:**
- Uses Solana Tracker API for Jupiter aggregator quotes
- Phantom wallet connection for transactions
- Supports both connected wallet and backend wallet swaps

**Metrics & Claiming:**
- Cron jobs (`under`/`over` functions) update holder counts and volumes every 5 minutes
- `claim-fees` function claims creator fees from pools
- Winners determined when `expires_at` timestamp passes

### Environment Configuration

Create `.env.local` from `.env.example`:
```bash
cp .env.example .env.local
```

Required variables:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
- Backend services require additional keys (see `.env.example`)

### Deployment

**Netlify (Frontend):**
- Configured via `netlify.toml`
- Builds and deploys from `dist/`
- Includes serverless functions in `netlify/functions/`

**Supabase (Backend):**
- Edge functions in `supabase/functions/`
- Database migrations in `supabase/migrations/`
- Cron schedules for metrics updates

## Key Implementation Details

### Token Launch Retry Logic
The `launch-pair` function implements retry with exponential backoff (up to 120s) to handle Railway backend timeouts when launching tokens.

### Real-time Updates
The app subscribes to Supabase table changes and updates the UI immediately when metrics, tokens, or status changes occur.

### Wallet Integration
- Phantom wallet adapter for user transactions
- Backend wallet for system operations (token launches, fee claims)
- Supports both connected and disconnected modes

### Fee Structure
- Trading fees accumulate in both UNDER and OVER pools
- When event concludes, winning side claims all fees from both pools
- Creator can claim fees after expiration
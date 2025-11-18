Supabase Scheduled Jobs

We moved recurring jobs to Supabase Cron. In addition to the existing refreshers (`under`, `over`), we now have:

- `future-props-ingest`: looks up upcoming (PrizePicks-style) prop lines via Grok and creates/upserts picks, optionally launching tokens.
- `auto-resolve-due`: finds expired picks and resolves outcomes via Grok, then triggers claim-fees distribution.

Prereqs
- Supabase CLI installed and logged in.
- Project linked: run `supabase link --project-ref <your-ref>` from repo root.
- Env secrets set in Supabase project:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SOLANA_TRACKER_KEY` (Data API key)

Deploy functions with no JWT (required for scheduler)

```
supabase functions deploy under --no-verify-jwt
supabase functions deploy over  --no-verify-jwt
supabase functions deploy future-props-ingest --no-verify-jwt
supabase functions deploy auto-resolve-due --no-verify-jwt
```

Create schedules

```
supabase functions schedule create under --cron "*/5 * * * *"
supabase functions schedule create over  --cron "*/5 * * * *"
supabase functions schedule create future-props-ingest --cron "*/30 * * * *"  # every 30 minutes
supabase functions schedule create auto-resolve-due   --cron "*/10 * * * *"  # every 10 minutes
```

Manual run (bulk)

```
supabase functions invoke under --no-verify-jwt --body '{"all":true}'
supabase functions invoke over  --no-verify-jwt --body '{"all":true}'
```

Notes
- The functions log per-row results and errors to Supabase logs and return them in the JSON response.
- The UI listens to `public.picks` realtime and updates immediately when rows are updated.
 - Set the following secrets in your Supabase project: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `XAI_API_KEY` (and optionally `XAI_API_BASE`, `XAI_DEFAULT_MODEL`).
 - To seed scheduled lookups, insert rows into `public.future_prop_requests` (see migration 20251016T120000_create_future_prop_requests.sql). Fields: `sport`, `player`, `team`, `prop`, `scope`, `date`, `run_interval_minutes`, `enabled`, `create_pick`, `auto_launch`.
 - Idempotency: future-props-ingest avoids duplicating picks by de-duping on `(name, category, expires_at±1d)` while status is `open`.


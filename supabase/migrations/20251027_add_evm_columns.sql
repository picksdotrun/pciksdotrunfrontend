-- Migration: add EVM market fields to picks table
-- Run in Supabase SQL editor or via CLI: supabase db execute < this_file.sql

BEGIN;

ALTER TABLE public.picks
  ADD COLUMN IF NOT EXISTS evm_market_address       text,
  ADD COLUMN IF NOT EXISTS evm_yes_token_address    text,
  ADD COLUMN IF NOT EXISTS evm_no_token_address     text,
  ADD COLUMN IF NOT EXISTS evm_chain                text NOT NULL DEFAULT 'bsc-mainnet',
  ADD COLUMN IF NOT EXISTS evm_asset_address        text,
  ADD COLUMN IF NOT EXISTS evm_fee_bps              integer,
  ADD COLUMN IF NOT EXISTS evm_end_time             timestamp with time zone,
  ADD COLUMN IF NOT EXISTS evm_cutoff_time          timestamp with time zone;

-- Ensure uniqueness of addresses when present
CREATE UNIQUE INDEX IF NOT EXISTS picks_evm_market_address_unq
  ON public.picks (evm_market_address)
  WHERE evm_market_address IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS picks_evm_yes_token_address_unq
  ON public.picks (evm_yes_token_address)
  WHERE evm_yes_token_address IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS picks_evm_no_token_address_unq
  ON public.picks (evm_no_token_address)
  WHERE evm_no_token_address IS NOT NULL;

-- Helpful time indexes for queries
CREATE INDEX IF NOT EXISTS picks_evm_end_time_idx
  ON public.picks (evm_end_time);

CREATE INDEX IF NOT EXISTS picks_evm_cutoff_time_idx
  ON public.picks (evm_cutoff_time);

COMMIT;


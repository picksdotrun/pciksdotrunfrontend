-- Remove follow triggers/functions so logic can live in the edge function
DROP TRIGGER IF EXISTS trg_follow_counts ON public.follows;
DROP FUNCTION IF EXISTS public.update_follow_metrics();
DROP FUNCTION IF EXISTS public.update_follower_counts();

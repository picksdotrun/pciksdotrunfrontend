alter table public.picks
  drop constraint if exists picks_win_side_check;

alter table public.picks
  add constraint picks_win_side_check
  check (
    win_side is null
    or win_side in ('less','more','void','yes','no')
  );

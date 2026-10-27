-- The MVP only supports the new-trader journey. Existing "Experienced" profiles are left alone,
-- but nobody can newly choose it until the intermediate and expert journeys ship.
create or replace function public.block_experienced_journey()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trading_experience = 'Experienced'
     and (tg_op = 'INSERT' or old.trading_experience is distinct from 'Experienced') then
    raise exception 'The intermediate and expert journeys are coming soon.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_experienced_journey on public.profiles;
create trigger profiles_block_experienced_journey
  before insert or update of trading_experience on public.profiles
  for each row execute function public.block_experienced_journey();

-- New Google accounts must confirm their email by link before they can write data.
-- app_metadata can only be changed with the service key, so a user cannot lift this gate themselves.
-- Accounts created before 2026-10-27, and email/password accounts, are never blocked.

create or replace function public.email_link_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select not (
              coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
              and coalesce(u.raw_app_meta_data ->> 'email_link_verified', 'false') <> 'true'
              and u.created_at >= timestamptz '2026-10-27 00:00:00+00'
            )
       from auth.users u
      where u.id = (select auth.uid())),
    false
  );
$$;

revoke all on function public.email_link_ok() from public;
grant execute on function public.email_link_ok() to authenticated;

-- Restrictive policies are combined (AND) with the existing per-user policies.
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'user_preferences', 'journal_entries', 'watchlist_items', 'zuri_journey']
  loop
    execute format('drop policy if exists "Email link required to create" on public.%I', t);
    execute format('drop policy if exists "Email link required to update" on public.%I', t);
    execute format('create policy "Email link required to create" on public.%I as restrictive for insert to authenticated with check (public.email_link_ok())', t);
    execute format('create policy "Email link required to update" on public.%I as restrictive for update to authenticated using (public.email_link_ok()) with check (public.email_link_ok())', t);
  end loop;

  foreach t in array array['journal_entries', 'watchlist_items']
  loop
    execute format('drop policy if exists "Email link required to delete" on public.%I', t);
    execute format('create policy "Email link required to delete" on public.%I as restrictive for delete to authenticated using (public.email_link_ok())', t);
  end loop;
end
$$;

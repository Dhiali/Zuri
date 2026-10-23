update public.profiles as profile
set
  display_name = coalesce(
    profile.display_name,
    nullif(
      left(
        coalesce(
          nullif(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
          nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), '')
        ),
        60
      ),
      ''
    )
  ),
  trading_experience = case
    when auth_user.raw_user_meta_data ->> 'trading_experience'
      in ('New to trading', 'Learning the basics', 'Experienced')
    then auth_user.raw_user_meta_data ->> 'trading_experience'
    else profile.trading_experience
  end,
  primary_markets = case
    when pg_catalog.jsonb_typeof(auth_user.raw_user_meta_data -> 'primary_markets') = 'array'
    then array(
      select market
      from pg_catalog.jsonb_array_elements_text(auth_user.raw_user_meta_data -> 'primary_markets') as markets(market)
      where market = any(array['Stocks', 'Crypto', 'Forex', 'Commodities']::text[])
    )
    else profile.primary_markets
  end
from auth.users as auth_user
where profile.id = auth_user.id;

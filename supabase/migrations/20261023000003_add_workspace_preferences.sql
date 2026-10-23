alter table public.user_preferences
  add column one_click_trading_enabled boolean not null default true,
  add column start_at_login_enabled boolean not null default true,
  add column save_chart_layout_enabled boolean not null default true,
  add column turbo_mode_enabled boolean not null default false,
  add column auto_reconnect_enabled boolean not null default true;

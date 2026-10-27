-- Lets Zuri record more of the journey for the leak finder: orders stopped by the
-- user's own limits, trade plans discussed with Zuri, and positions closed outside Zuri.
alter table public.journey_events drop constraint if exists journey_events_kind_check;

alter table public.journey_events add constraint journey_events_kind_check check (kind in (
  'watchlist_add', 'watchlist_remove', 'symbol_viewed', 'order_placed', 'position_detected',
  'order_blocked', 'plan_proposed', 'position_closed'
));

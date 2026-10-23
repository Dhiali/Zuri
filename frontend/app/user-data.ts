import { getSupabaseBrowserClient } from "./supabase";

export type JournalSide = "Watching" | "Long" | "Short";

export type JournalEntry = {
  id: string;
  symbol: string;
  timeframe: string;
  side: JournalSide;
  setup: string;
  entry: string;
  stop: string;
  target: string;
  note: string;
  createdAt: string;
};

export type UserProfile = {
  id: string;
  display_name: string | null;
  trading_experience: string | null;
  primary_markets: string[];
};

export type UserPreferences = {
  user_id: string;
  default_symbol: string;
  default_timeframe: string;
  color_theme: string;
  language: string;
  time_zone: string;
  compact_mode: boolean;
  trade_confirmation_required: boolean;
  default_order_type: string;
  order_fill_policy: string;
  max_open_positions: number;
  allow_hedging: boolean;
  auto_close_on_stop: boolean;
  max_daily_loss_percent: number;
  max_trade_risk_percent: number;
  max_correlation_exposure_percent: number;
  price_alerts_enabled: boolean;
  execution_notifications_enabled: boolean;
  journal_reminders_enabled: boolean;
  desktop_notifications_enabled: boolean;
  hide_account_values: boolean;
  allow_data_exports: boolean;
  one_click_trading_enabled: boolean;
  start_at_login_enabled: boolean;
  save_chart_layout_enabled: boolean;
  turbo_mode_enabled: boolean;
  auto_reconnect_enabled: boolean;
};

export const defaultUserPreferences: Omit<UserPreferences, "user_id"> = {
  default_symbol: "BTCUSD",
  default_timeframe: "15m",
  color_theme: "Midnight",
  language: "English",
  time_zone: "UTC",
  compact_mode: false,
  trade_confirmation_required: true,
  default_order_type: "Market",
  order_fill_policy: "FOK",
  max_open_positions: 6,
  allow_hedging: false,
  auto_close_on_stop: true,
  max_daily_loss_percent: 2,
  max_trade_risk_percent: 0.75,
  max_correlation_exposure_percent: 35,
  price_alerts_enabled: true,
  execution_notifications_enabled: true,
  journal_reminders_enabled: true,
  desktop_notifications_enabled: false,
  hide_account_values: false,
  allow_data_exports: true,
  one_click_trading_enabled: true,
  start_at_login_enabled: true,
  save_chart_layout_enabled: true,
  turbo_mode_enabled: false,
  auto_reconnect_enabled: true,
};

const legacyJournalKey = "zuri-journal-entries";
const legacyWatchlistKey = "zuri-watchlist-symbols";
const journalMigrationKey = (userId: string) => `zuri-journal-migrated:${userId}`;
const watchlistMigrationKey = (userId: string) => `zuri-watchlist-migrated:${userId}`;
export const initialWatchlistSymbols = ["BTCUSD", "ETHUSD", "SOLUSD", "EURUSD", "GOLD", "AAPL"];

function requireSupabase() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured. Add the public project URL and key to frontend/.env.local.");
  return supabase;
}

function toJournalEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    side: row.side as JournalSide,
    setup: String(row.setup ?? ""),
    entry: row.entry_price == null ? "" : String(row.entry_price),
    stop: row.stop_price == null ? "" : String(row.stop_price),
    target: row.target_price == null ? "" : String(row.target_price),
    note: String(row.note ?? ""),
    createdAt: String(row.created_at),
  };
}

function optionalPrice(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const price = Number(trimmed);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Journal prices must be positive numbers.");
  }
  return price;
}

export async function loadUserProfile(userId: string) {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("id, display_name, trading_experience, primary_markets")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`Unable to load your profile: ${error.message}`);
  return data as UserProfile;
}

export async function saveUserProfile(profile: Pick<UserProfile, "id" | "display_name" | "trading_experience" | "primary_markets">) {
  const { error } = await requireSupabase()
    .from("profiles")
    .upsert(profile, { onConflict: "id" });
  if (error) throw new Error(`Unable to save your profile: ${error.message}`);
}

export async function loadUserPreferences(userId: string) {
  const { data, error } = await requireSupabase()
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`Unable to load your preferences: ${error.message}`);
  return data as UserPreferences;
}

export async function saveUserPreferences(preferences: UserPreferences) {
  const { error } = await requireSupabase()
    .from("user_preferences")
    .upsert(preferences, { onConflict: "user_id" });
  if (error) throw new Error(`Unable to save your preferences: ${error.message}`);
}

export async function loadJournalEntries(userId: string) {
  await migrateLegacyJournal(userId);
  const { data, error } = await requireSupabase()
    .from("journal_entries")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Unable to load your journal: ${error.message}`);
  return (data ?? []).map((row) => toJournalEntry(row as Record<string, unknown>));
}

async function migrateLegacyJournal(userId: string) {
  if (typeof window === "undefined" || window.localStorage.getItem(journalMigrationKey(userId))) return;
  const saved = window.localStorage.getItem(legacyJournalKey);
  if (saved) {
    let entries: unknown;
    try {
      entries = JSON.parse(saved) as unknown;
    } catch {
      throw new Error("Your saved browser journal could not be read. Its data was left unchanged.");
    }
    if (!Array.isArray(entries)) {
      throw new Error("Your saved browser journal has an invalid format. Its data was left unchanged.");
    }

    const records = entries.map((value: unknown) => {
      if (!value || typeof value !== "object") {
        throw new Error("A saved browser journal entry is invalid. Its data was left unchanged.");
      }
      const entry = value as Partial<JournalEntry>;
      const createdAt = entry.createdAt && Number.isFinite(Date.parse(entry.createdAt))
        ? new Date(entry.createdAt).toISOString()
        : new Date().toISOString();
      const id = typeof entry.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id)
        ? entry.id
        : undefined;
      if (
        typeof entry.symbol !== "string"
        || typeof entry.timeframe !== "string"
        || !["Watching", "Long", "Short"].includes(entry.side ?? "")
        || typeof entry.setup !== "string"
        || typeof entry.note !== "string"
      ) {
        throw new Error("A saved browser journal entry is invalid. Its data was left unchanged.");
      }
      return {
        ...(id ? { id } : {}),
        user_id: userId,
        symbol: entry.symbol,
        timeframe: entry.timeframe,
        side: entry.side,
        setup: entry.setup,
        entry_price: optionalPrice(entry.entry ?? ""),
        stop_price: optionalPrice(entry.stop ?? ""),
        target_price: optionalPrice(entry.target ?? ""),
        note: entry.note,
        created_at: createdAt,
      };
    });
    if (records.length > 0) {
      const { error } = await requireSupabase().from("journal_entries").insert(records);
      if (error) throw new Error(`Unable to import your saved browser journal: ${error.message}. Its local data was preserved.`);
    }
    window.localStorage.removeItem(legacyJournalKey);
  }
  window.localStorage.setItem(journalMigrationKey(userId), "true");
}

export async function addJournalEntry(userId: string, entry: Omit<JournalEntry, "id" | "createdAt">) {
  const { data, error } = await requireSupabase()
    .from("journal_entries")
    .insert({
      user_id: userId,
      symbol: entry.symbol,
      timeframe: entry.timeframe,
      side: entry.side,
      setup: entry.setup,
      entry_price: optionalPrice(entry.entry),
      stop_price: optionalPrice(entry.stop),
      target_price: optionalPrice(entry.target),
      note: entry.note,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Unable to save your journal entry: ${error.message}`);
  return toJournalEntry(data as Record<string, unknown>);
}

export async function deleteJournalEntry(userId: string, entryId: string) {
  const { error } = await requireSupabase()
    .from("journal_entries")
    .delete()
    .eq("user_id", userId)
    .eq("id", entryId);
  if (error) throw new Error(`Unable to delete your journal entry: ${error.message}`);
}

export async function loadWatchlist(userId: string) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("symbol")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(`Unable to load your watchlist: ${error.message}`);
  let symbols = (data ?? []).map((item) => item.symbol as string);
  if (typeof window !== "undefined" && !window.localStorage.getItem(watchlistMigrationKey(userId))) {
    const saved = window.localStorage.getItem(legacyWatchlistKey);
    let legacySymbols: string[] = [];
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every((symbol) => typeof symbol === "string")) {
          throw new Error("invalid format");
        }
        legacySymbols = [...new Set((parsed as string[]).filter((symbol) => initialWatchlistSymbols.includes(symbol)))];
      } catch {
        throw new Error("Your saved browser watchlist could not be read. Its data was left unchanged.");
      }
    }
    const nextSymbols = symbols.length > 0
      ? [...new Set([...symbols, ...legacySymbols])]
      : (legacySymbols.length > 0 ? legacySymbols : initialWatchlistSymbols);
    await saveWatchlist(userId, nextSymbols);
    symbols = nextSymbols;
    window.localStorage.removeItem(legacyWatchlistKey);
    window.localStorage.setItem(watchlistMigrationKey(userId), "true");
  }
  return symbols;
}

export async function saveWatchlist(userId: string, symbols: string[]) {
  const { error } = await requireSupabase().rpc("set_my_watchlist", { p_symbols: symbols });
  if (error) throw new Error(`Unable to update your watchlist: ${error.message}`);
}

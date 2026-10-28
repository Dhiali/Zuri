"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useZuriAuth, ZuriAuthGate } from "./auth";
import { BrokerConnections } from "./broker-connections";
import { HistoryView } from "./history-view";
import { CoachingPanel } from "./dashboard-insights";
import { TradeConversation } from "./trade-conversation";
import { FirstTradeCoach } from "./trade-coach";
import { MarketClock, formatOpenTime, useMarketStatus } from "./market-clock";
import { PendingOrders } from "./pending-orders";
import { SnapshotGallery, captureScreenForTrade } from "./trade-snapshots";
import { ChartResearch } from "./chart-research";
import { backendUrl, formatMoney, useLinkedAccount, type LinkedAccountState, type LinkedPosition } from "./linked-account";
import { TIME_ZONE_NAMES, formatClock, formatDateTime, formatDeskDate, setActiveTimeZone } from "./time-zone";
import {
  addJournalEntry,
  deleteJournalEntry,
  loadJournalEntries,
  loadUserProfile,
  loadUserPreferences,
  loadWatchlist,
  loadZuriJourney,
  saveUserProfile,
  saveUserPreferences,
  saveWatchlist,
  saveZuriJourney,
  type JournalEntry,
  type JournalSide,
  type UserProfile,
  type UserPreferences,
  type ZuriJourney,
} from "./user-data";
import { ZuriMascot } from "./zuri-journey";
import { loadInvolvement, saveInvolvement, loadLayout, saveLayout, ZuriOnboarding, type Involvement, type MarketLayout, type OnboardingResult } from "./zuri-onboarding";
import { ZuriGuide } from "./zuri-guide";
import { logZuriEvent, useZuriAccess, useZuriNudges, ZuriTakeover, ZuriTradeCard, type Walkthrough, type WalkthroughStep, type ZuriAction, type ZuriNudge } from "./zuri-agent";
import { grabScreenFrame, startScreenShare, useScreenShareActive } from "./screen-capture";
import { draftJournalNote, JournalInsights, trackJourneyEvent } from "./journal-insights";

type Section = "Charts" | "Dashboard" | "Trade" | "History" | "Journal" | "Settings";
type SettingsTab = "Account" | "Broker" | "Trading" | "Risk" | "Platform" | "Display" | "Security";
type Instrument = { symbol: string; name: string; price: string; change: string; up: boolean; icon: string; group: string; high?: string; low?: string; volume?: string; hasQuote?: boolean };
type MarketNewsArticle = { id: string; title: string; summary: string; source: string; published_at: string | null; url: string; related_symbols: string[]; market_wide: boolean; category: "trading" | "world" };
type MarketNewsResponse = { articles: MarketNewsArticle[]; fetched_at: string; refresh_after_seconds: number; sources: string[]; warnings: string[] };
type BacktestNewsContext = { title: string; published_at: string | null };
type RealQuote = { price: number; change_percent: number; high: number | null; low: number | null; volume: number | null };

// Only the markets Zuri can supply a real quote for. Prices stay empty ("—") until the real feed answers.
const initialInstruments: Instrument[] = [
  { symbol: "BTCUSD", name: "Bitcoin / U.S. Dollar", price: "—", change: "—", up: true, icon: "₿", group: "Crypto" },
  { symbol: "ETHUSD", name: "Ethereum / U.S. Dollar", price: "—", change: "—", up: true, icon: "◆", group: "Crypto" },
  { symbol: "SOLUSD", name: "Solana / U.S. Dollar", price: "—", change: "—", up: true, icon: "◎", group: "Crypto" },
  { symbol: "EURUSD", name: "Euro / U.S. Dollar", price: "—", change: "—", up: true, icon: "€", group: "Forex" },
  { symbol: "GOLD", name: "Gold Spot / U.S. Dollar", price: "—", change: "—", up: true, icon: "Au", group: "Commodities" },
  { symbol: "AAPL", name: "Apple Inc.", price: "—", change: "—", up: true, icon: "A", group: "Stocks" },
];

const priceDigits = (instrument: Pick<Instrument, "symbol" | "group">) => (instrument.group === "Forex" ? 5 : instrument.symbol === "BTCUSD" ? 0 : 2);
const formatPriceValue = (instrument: Pick<Instrument, "symbol" | "group">, value: number) => value.toLocaleString("en-US", { minimumFractionDigits: priceDigits(instrument), maximumFractionDigits: priceDigits(instrument) });
const formatVolume = (value: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
const plainPrice = (price: string) => (/\d/.test(price) ? price.replace(/,/g, "") : "");

function applyQuotes(current: Instrument[], quotes: Record<string, RealQuote>): Instrument[] {
  return current.map((instrument) => {
    const quote = quotes[instrument.symbol];
    if (!quote) return instrument;
    return {
      ...instrument,
      price: formatPriceValue(instrument, quote.price),
      change: `${quote.change_percent >= 0 ? "+" : "−"}${Math.abs(quote.change_percent).toFixed(2)}%`,
      up: quote.change_percent >= 0,
      high: quote.high === null ? undefined : formatPriceValue(instrument, quote.high),
      low: quote.low === null ? undefined : formatPriceValue(instrument, quote.low),
      volume: quote.volume ? formatVolume(quote.volume) : undefined,
      hasQuote: true,
    };
  });
}

const chartTools = ["＋", "╱", "⌁", "⌖", "⌕", "T", "◉", "⌁", "⊞", "⌂", "◌", "♧"];
const timeframes = ["1m", "5m", "15m", "1h", "4h", "1D", "1W"];
const tradingViewSymbols: Record<string, string> = {
  BTCUSD: "COINBASE:BTCUSD",
  ETHUSD: "COINBASE:ETHUSD",
  SOLUSD: "COINBASE:SOLUSD",
  EURUSD: "FX:EURUSD",
  GOLD: "TVC:GOLD",
  AAPL: "NASDAQ:AAPL",
};
const tradingViewIntervals: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1D": "D", "1W": "W" };

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Charts: "M3 3v18h18M7 14l4-4 3 3 6-7",
    Dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
    Trade: "M4 18V6m0 12h16M8 14l3-4 3 2 5-6",
    History: "M3 12a9 9 0 1 0 2.6-6.4L3 8m0-5v5h5m4-1v5l4 2",
    Journal: "M8 4h11v17H5V7zm-3 3h11M9 12h6m-6 4h6",
    Settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.Charts} /></svg>;
}

function Chart({ symbol, timeframe, drawing, aiOnChart }: { symbol: Instrument; timeframe: string; drawing: string; aiOnChart: boolean }) {
  const widgetConfig = {
      autosize: true,
      symbol: tradingViewSymbols[symbol.symbol] ?? symbol.symbol,
      interval: tradingViewIntervals[timeframe] ?? "15",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      withdateranges: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      save_image: true,
      details: false,
      hotlist: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
      backgroundColor: "#111315",
      gridColor: "#24292a",
      toolbar_bg: "#151719",
    };
  const widgetUrl = `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(widgetConfig))}`;

  return (
    <div className="chart-wrap" data-active-tool={drawing}>
      <iframe key={`${symbol.symbol}-${timeframe}`} className="tradingview-embed" src={widgetUrl} title={`${symbol.symbol} interactive TradingView chart`} />
      {aiOnChart && <div className="tv-ai-overlay" aria-label={`Zuri AI context for ${symbol.symbol}`}>✳ Zuri AI context · {symbol.symbol}</div>}
    </div>
  );
}

export default function Home() {
  return (
    <ZuriAuthGate>
      <TradingWorkspace />
    </ZuriAuthGate>
  );
}

function TradingWorkspace() {
  const { session, signOut } = useZuriAuth();
  const linkedAccount = useLinkedAccount(session?.access_token ?? "");
  const [deskDate, setDeskDate] = useState("");
  const [deskTime, setDeskTime] = useState("");
  const [accountError, setAccountError] = useState("");
  const [dataError, setDataError] = useState("");
  const [section, setSection] = useState<Section>("Charts");
  const [instruments, setInstruments] = useState(initialInstruments);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const watchlistSnapshot = JSON.stringify(watchlistSymbols);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  setActiveTimeZone(userPreferences?.time_zone);

  const [workspaceDataUserId, setWorkspaceDataUserId] = useState<string | null>(null);
  const watchlistInstruments = instruments.filter((instrument) => watchlistSymbols.includes(instrument.symbol));
  const [selectedSymbol, setSelectedSymbol] = useState(initialInstruments[0].symbol);
  const [timeframe, setTimeframe] = useState("15m");
  useEffect(() => {
    if (!session?.user.id || workspaceDataUserId !== session.user.id || userPreferences?.save_chart_layout_enabled === false) return;
    window.localStorage.setItem(`zuri.lastChart.${session.user.id}`, JSON.stringify({ symbol: selectedSymbol, timeframe }));
  }, [session?.user.id, workspaceDataUserId, userPreferences?.save_chart_layout_enabled, selectedSymbol, timeframe]);
  const [activeTool, setActiveTool] = useState("");
  const [orderSide, setOrderSide] = useState<"Buy" | "Sell">("Buy");
  const [query, setQuery] = useState("");
  const [aiOnChart, setAiOnChart] = useState(false);
  const [watchlistOpen] = useState(true);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalDraftOpen, setJournalDraftOpen] = useState(false);
  const [journalDraftSide, setJournalDraftSide] = useState<JournalSide>("Watching");
  const [marketNews, setMarketNews] = useState<MarketNewsResponse | null>(null);
  const [marketNewsLoading, setMarketNewsLoading] = useState(true);
  const [marketNewsError, setMarketNewsError] = useState("");
  const [marketNewsRefresh, setMarketNewsRefresh] = useState(0);
  const [assistantNewsRequest, setAssistantNewsRequest] = useState<{ article: MarketNewsArticle } | null>(null);
  const [backtestNewsContext, setBacktestNewsContext] = useState<BacktestNewsContext | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [journey, setJourney] = useState<ZuriJourney | null>(null);
  const userId = session?.user.id;
  const accessToken = session?.access_token ?? "";
  const [journalRefresh, setJournalRefresh] = useState(0);

  const reloadJournal = useCallback(() => {
    if (!userId) return;
    void loadJournalEntries(userId).then((entries) => {
      setJournalEntries(entries);
      setJournalRefresh((value) => value + 1);
    }).catch(() => undefined);
  }, [userId]);

  // A missing table or load failure must never block the workspace.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadZuriJourney(userId).then((loaded) => {
      if (!cancelled) setJourney(loaded);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const updateJourney = (next: ZuriJourney) => {
    setJourney(next);
    saveZuriJourney(next).catch((saveError: unknown) => {
      setDataError(saveError instanceof Error ? saveError.message : "Unable to save your Zuri journey.");
    });
  };
  const marketNewsLoaded = useRef(false);
  const activeSymbol = watchlistSymbols.includes(selectedSymbol) ? selectedSymbol : watchlistInstruments[0]?.symbol ?? initialInstruments[0].symbol;
  const symbol = instruments.find((instrument) => instrument.symbol === activeSymbol) ?? initialInstruments[0];

  const activeSymbolWatched = watchlistSymbols.includes(activeSymbol);
  useEffect(() => {
    if (section === "Charts" && workspaceDataUserId === userId && activeSymbolWatched) trackJourneyEvent(accessToken, "symbol_viewed", activeSymbol);
  }, [section, activeSymbol, activeSymbolWatched, accessToken, userId, workspaceDataUserId]);
  const aiBrief = symbol.hasQuote
    ? `${symbol.symbol} is ${symbol.change} on the day${symbol.low && symbol.high ? `, trading between ${symbol.low} and ${symbol.high}` : ""}. This is a snapshot of price action, not a forecast. Ask Zuri for a full chart analysis, then check price action and risk before you act.`
    : "Waiting for the real market quote. Ask Zuri for a chart analysis once it loads.";
  const searchUniverse = query.trim() ? instruments : watchlistInstruments;
  const filteredInstruments = searchUniverse.filter((item) => `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()));
  const [layout, setLayout] = useState<MarketLayout | null>(null);
  const [marketTab, setMarketTab] = useState("");
  const [openMarkets, setOpenMarkets] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(loadLayout());
  }, []);
  // Zuri's layout plan only applies to the plain watchlist (not a search) and only when more than one market is on it.
  const presentMarkets = [...new Set(filteredInstruments.map((item) => item.group))];
  const marketOrder = [...(layout?.markets.map((entry) => entry.market) ?? []), ...presentMarkets].filter((market, index, all) => all.indexOf(market) === index && presentMarkets.includes(market));
  const layoutActive = Boolean(layout) && layout!.mode !== "list" && !query.trim() && presentMarkets.length > 1;
  const activeMarket = [marketTab, layout?.focus ?? "", marketOrder[0] ?? ""].find((market) => market && presentMarkets.includes(market)) ?? "";
  const symbolDetail = layout?.markets.find((entry) => entry.market === symbol.group)?.detail ?? "full";
  const renderQuoteRow = (item: Instrument) => {
    const isInWatchlist = watchlistSymbols.includes(item.symbol);
    return <div key={item.symbol} className={isInWatchlist && symbol.symbol === item.symbol ? "watch-row selected" : "watch-row"}>
      <button className="watch-row-main" onClick={() => isInWatchlist ? (setSelectedSymbol(item.symbol), setSection("Charts")) : addInstrument(item.symbol)} aria-label={isInWatchlist ? `Select ${item.symbol}` : `Preview ${item.symbol} quote and add to watchlist`}>
        <span className={`watch-icon ${item.group.toLowerCase()}`}>{item.icon}</span><span className="watch-symbol"><b>{item.symbol}</b><small>{item.group}</small></span><span className="quote-price">{item.price}</span><span className={`quote-price ${item.hasQuote ? (item.up ? "positive" : "negative") : "muted"}`}>{item.change}</span>
      </button>
      <button className="watch-remove" title={isInWatchlist ? `Remove ${item.symbol} from watchlist` : `Add ${item.symbol} to watchlist`} aria-label={isInWatchlist ? `Remove ${item.symbol} from watchlist` : `Add ${item.symbol} to watchlist`} onClick={() => isInWatchlist ? removeInstrument(item.symbol) : addInstrument(item.symbol)}>{isInWatchlist ? "×" : "+"}</button>
    </div>;
  };

  useEffect(() => {
    const updateDeskDate = () => {
      const now = new Date();
      setDeskDate(formatDeskDate(now));
      setDeskTime(formatClock(now));
    };

    updateDeskDate();
    const timer = window.setInterval(updateDeskDate, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    let cancelled = false;

    void Promise.all([
      loadWatchlist(session.user.id),
      loadJournalEntries(session.user.id),
      loadUserPreferences(session.user.id),
    ]).then(([symbols, entries, preferences]) => {
      if (cancelled) return;
      setWatchlistSymbols(symbols);
      setJournalEntries(entries);
      setUserPreferences(preferences);
      let remembered: { symbol?: string; timeframe?: string } = {};
      try { remembered = JSON.parse(window.localStorage.getItem(`zuri.lastChart.${session.user.id}`) ?? "{}") as typeof remembered; } catch { /* nothing remembered */ }
      const useRemembered = preferences.save_chart_layout_enabled !== false;
      const startSymbol = useRemembered && remembered.symbol && symbols.includes(remembered.symbol) ? remembered.symbol : null;
      setSelectedSymbol(startSymbol ?? (symbols.includes(preferences.default_symbol)
        ? preferences.default_symbol
        : symbols[0] ?? initialInstruments[0].symbol));
      setTimeframe(useRemembered && remembered.timeframe && timeframes.includes(remembered.timeframe) ? remembered.timeframe : preferences.default_timeframe);
      setWorkspaceDataUserId(session.user.id);
      setDataError("");
    }).catch((loadError: unknown) => {
      if (cancelled) return;
      setDataError(loadError instanceof Error ? loadError.message : "Unable to load your saved workspace data.");
    });

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      const all = initialInstruments.map((item) => item.symbol).join(",");
      void fetch(`${backendUrl}/api/quotes?symbols=${all}`, { headers: { Authorization: `Bearer ${accessToken}` } })
        .then((response) => (response.ok ? response.json() : null))
        .then((result: { quotes?: Record<string, RealQuote> } | null) => {
          if (!cancelled && result?.quotes) setInstruments((current) => applyQuotes(current, result.quotes ?? {}));
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 20_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    const fetchNews = async () => {
      if (!marketNewsLoaded.current) setMarketNewsLoading(true);
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
        const symbols = JSON.parse(watchlistSnapshot) as string[];
        const response = await fetch(`${backendUrl}/api/market-news?symbols=${encodeURIComponent(symbols.join(","))}`);
        const result = await response.json() as MarketNewsResponse & { detail?: string };
        if (!response.ok) {
          throw new Error(result.detail || `News request failed (${response.status}).`);
        }
        if (!Array.isArray(result.articles) || !Array.isArray(result.sources)) {
          throw new Error("The market-news service returned an invalid response.");
        }
        if (!cancelled) {
          setMarketNews(result);
          setMarketNewsError("");
        }
      } catch (requestError) {
        if (!cancelled) {
          setMarketNewsError(requestError instanceof Error ? requestError.message : "Unable to load market news.");
        }
      } finally {
        if (!cancelled) {
          marketNewsLoaded.current = true;
          setMarketNewsLoading(false);
        }
      }
    };

    void fetchNews();
    const refreshTimer = window.setInterval(() => void fetchNews(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [watchlistSnapshot, marketNewsRefresh]);

  const askZuriAboutNews = (article: MarketNewsArticle) => {
    setAssistantNewsRequest({ article });
    setAssistantDraft(`Explain what this reported story could mean for ${symbol.symbol}. Separate confirmed information from possible market effects, and include the main risks and uncertainties.`);
    setAssistantOpen(true);
  };

  const useNewsForBacktest = (article: MarketNewsArticle) => {
    setBacktestNewsContext({ title: article.title, published_at: article.published_at });
    setSection("Charts");
  };

  const saveJournalEntry = async (entry: Omit<JournalEntry, "id" | "createdAt" | "source">) => {
    if (!session?.user.id) return;
    try {
      const savedEntry = await addJournalEntry(session.user.id, entry);
      setJournalEntries((current) => [savedEntry, ...current]);
      setJournalDraftOpen(false);
      setSection("Journal");
      setDataError("");
    } catch (saveError) {
      setDataError(saveError instanceof Error ? saveError.message : "Unable to save your journal entry.");
    }
  };

  const removeJournalEntry = async (entryId: string) => {
    if (!session?.user.id) return;
    try {
      await deleteJournalEntry(session.user.id, entryId);
      setJournalEntries((current) => current.filter((entry) => entry.id !== entryId));
      setDataError("");
    } catch (deleteError) {
      setDataError(deleteError instanceof Error ? deleteError.message : "Unable to delete your journal entry.");
    }
  };

  const updateWatchlist = async (symbols: string[]) => {
    if (!session?.user.id) return;
    try {
      await saveWatchlist(session.user.id, symbols);
      setWatchlistSymbols(symbols);
      setDataError("");
    } catch (saveError) {
      setDataError(saveError instanceof Error ? saveError.message : "Unable to update your watchlist.");
    }
  };

  const removeInstrument = (symbolToRemove: string) => {
    trackJourneyEvent(session?.access_token ?? "", "watchlist_remove", symbolToRemove);
    const remainingSymbols = watchlistSymbols.filter((item) => item !== symbolToRemove);
    void updateWatchlist(remainingSymbols);
    const remaining = watchlistInstruments.filter((instrument) => instrument.symbol !== symbolToRemove);
    if (selectedSymbol === symbolToRemove) setSelectedSymbol(remaining[0]?.symbol ?? initialInstruments[0].symbol);
  };

  const addInstrument = (symbolToAdd: string) => {
    if (watchlistSymbols.includes(symbolToAdd)) return;
    trackJourneyEvent(session?.access_token ?? "", "watchlist_add", symbolToAdd);
    void updateWatchlist([...watchlistSymbols, symbolToAdd]);
    setSelectedSymbol(symbolToAdd);
    setSection("Charts");
    setQuery("");
  };

  const [settingsRequest, setSettingsRequest] = useState<{ tab?: string; prefill?: WalkthroughStep["prefill"]; n: number } | null>(null);
  const [walkthrough, setWalkthrough] = useState<Walkthrough | null>(null);
  const { access: zuriAccess, update: updateZuriAccess } = useZuriAccess();
  const { nudges, dismiss: dismissNudge } = useZuriNudges(accessToken);
  const [involvement, setInvolvement] = useState<Involvement>("side_by_side");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInvolvement(loadInvolvement());
  }, []);
  const changeInvolvement = (value: Involvement) => { setInvolvement(value); saveInvolvement(value); };
  // A need-to-know buddy only speaks up for alerts, an occasional one adds warnings, a side-by-side one shares everything.
  const visibleNudges = nudges.filter((nudge) => involvement === "side_by_side" || nudge.severity === "alert" || (involvement === "occasional" && nudge.severity === "warning"));
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingForced, setOnboardingForced] = useState(false);
  const [onboardingStartedHere, setOnboardingStartedHere] = useState(false);
  const onboardingSeenBefore = Boolean(journey?.completed_steps.includes("onboarding:shown"));
  useEffect(() => {
    if (journey?.phase !== "intro" || onboardingSeenBefore) return;
    const timer = window.setTimeout(() => setOnboardingReady(true), 4000);
    return () => window.clearTimeout(timer);
  }, [journey?.phase, onboardingSeenBefore]);
  // Zuri only takes focus on the very first visit: the moment she does, that is recorded so a return visit never repeats it.
  useEffect(() => {
    if (!journey || journey.phase !== "intro" || !onboardingReady || onboardingSeenBefore) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnboardingStartedHere(true);
    updateJourney({ ...journey, completed_steps: [...new Set([...journey.completed_steps, "onboarding:shown"])] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingReady, journey?.phase, onboardingSeenBefore]);
  const showOnboarding = journey?.phase === "intro" && (onboardingForced || onboardingStartedHere || (onboardingReady && !onboardingSeenBefore));
  const [bubble, setBubble] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken || journey?.phase !== "intro" || !onboardingSeenBefore || onboardingStartedHere) return;
    if (window.sessionStorage.getItem("zuri.bubble.dismissed")) return;
    const controller = new AbortController();
    void fetch(`${backendUrl}/api/zuri/greeting`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ visit: "returning", visit_count: 2, local_hour: new Date().getHours(), section: "Dashboard", welcome_shown_before: true }),
    }).then((response) => (response.ok ? response.json() : null)).then((data: { message?: string } | null) => { if (data?.message) setBubble(data.message); }).catch(() => undefined);
    return () => controller.abort();
  }, [accessToken, journey?.phase, onboardingSeenBefore, onboardingStartedHere]);
  const dismissBubble = () => { window.sessionStorage.setItem("zuri.bubble.dismissed", "1"); setBubble(null); };

  type NextMove = { headline: string; goal: string; walkthrough: Walkthrough | null; chat_prompt: string | null; why?: string };
  const [nextStep, setNextStep] = useState<{ primary: NextMove; alternatives: NextMove[] } | null>(null);
  const [nextStepBusy, setNextStepBusy] = useState(false);
  const [nextStepError, setNextStepError] = useState("");
  const nextStepAt = useRef(0);
  const loadNextStep = useCallback(async () => {
    if (!accessToken) return;
    setNextStepBusy(true);
    setNextStepError("");
    try {
      const response = await fetch(`${backendUrl}/api/zuri/next-step?tz_offset_minutes=${-new Date().getTimezoneOffset()}&layout=${encodeURIComponent(JSON.stringify(loadLayout() ?? null))}`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error("Zuri could not decide on a next step right now.");
      setNextStep((await response.json()) as { primary: NextMove; alternatives: NextMove[] });
      nextStepAt.current = Date.now();
    } catch (nextError) {
      setNextStepError(nextError instanceof Error ? nextError.message : "Zuri could not decide on a next step right now.");
    } finally {
      setNextStepBusy(false);
    }
  }, [accessToken]);
  const runNextStep = (move: NextMove) => {
    if (move.walkthrough) setWalkthrough(move.walkthrough);
    else { setAssistantDraft(move.chat_prompt ?? ""); setAssistantOpen(true); }
  };
  const nextStepBroker = linkedAccount.data?.broker ?? "";
  useEffect(() => {
    if (section !== "Dashboard" || journey?.phase !== "done" || !accessToken) return;
    if (nextStepAt.current && Date.now() - nextStepAt.current < 10 * 60_000) return;
    void loadNextStep();
  }, [section, journey?.phase, accessToken, loadNextStep]);
  useEffect(() => {
    // Linking a broker changes what is best, so Zuri re-decides.
    nextStepAt.current = 0;
  }, [nextStepBroker]);

  const finishOnboarding = async (result: OnboardingResult) => {
    if (!journey) return;
    saveInvolvement(result.involvement);
    setInvolvement(result.involvement);
    updateZuriAccess({ see: result.seeScreen, act: result.actOnScreen });
    let tour: Walkthrough | null = null;
    try {
      const response = await fetch(`${backendUrl}/api/zuri/onboarding/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ tour: result.tour, involvement: result.involvement, see_screen: result.seeScreen,         act_on_screen: result.actOnScreen, market_levels: result.marketLevels }),
      });
              if (response.ok) {
                const saved = (await response.json()) as { walkthrough?: Walkthrough | null; layout?: MarketLayout };
                tour = saved.walkthrough ?? null;
                if (saved.layout?.markets.length) { saveLayout(saved.layout); setLayout(saved.layout); }
              }
    } catch { /* the choices still apply locally */ }
    const experience = session?.user.user_metadata?.trading_experience as string | undefined;
    updateJourney({
      ...journey, phase: "done", mode: "assistant",
      level: journey.level ?? (experience === "Experienced" ? "advancing" : experience === "Learning the basics" ? "building" : "foundations"),
      completed_steps: [...new Set([...journey.completed_steps, "guide:done"])],
    });
    if (tour) setWalkthrough(tour);
  };

  const buildScreenState = () => ({
    quote: symbol.hasQuote && watchlistSymbols.includes(symbol.symbol) ? { symbol: symbol.symbol, price: symbol.price, change: symbol.change } : null,
    watchlist: watchlistInstruments.map((item) => ({ symbol: item.symbol, price: item.price, change: item.change })),
    available_symbols: instruments.map((item) => item.symbol),
    positions: (linkedAccount.data?.positions ?? []).slice(0, 30).map((position) => ({
      symbol: position.symbol, side: position.side, quantity: position.quantity, avg_entry_price: position.avg_entry_price,
      current_price: position.current_price, unrealized_pl: position.unrealized_pl, unrealized_plpc: position.unrealized_plpc,
    })),
    news: (marketNews?.articles ?? []).slice(0, 8).map((article) => ({ title: article.title.slice(0, 220), source: article.source, published_at: article.published_at })),
    journal: journalEntries.slice(0, 10).map((entry) => ({ symbol: entry.symbol, side: entry.side, setup: entry.setup.slice(0, 60), note: entry.note.slice(0, 240), created_at: entry.createdAt })),
    broker: linkedAccount.data?.broker_name ?? null,
    equity: linkedAccount.data?.account.equity ?? null,
    max_trade_risk_percent: userPreferences?.max_trade_risk_percent ?? null,
    max_daily_loss_percent: userPreferences?.max_daily_loss_percent ?? null,
    active_drawing_tool: activeTool ? activeTool.slice(0, 10) : null,
    journal_draft_open: journalDraftOpen,
    settings_tab: section === "Settings" ? settingsRequest?.tab ?? null : null,
  });

  // Every action runs only after the user pressed Approve on its card.
  const executeZuriAction = async (action: ZuriAction): Promise<string> => {
    const args = action.args;
    const target = typeof args.symbol === "string" ? args.symbol : "";
    if (action.type === "open_chart") {
      if (!watchlistSymbols.includes(target)) await updateWatchlist([...watchlistSymbols, target]);
      setSelectedSymbol(target);
      if (typeof args.timeframe === "string" && timeframes.includes(args.timeframe)) setTimeframe(args.timeframe);
      setSection("Charts");
      return `Opened ${target}.`;
    }
    if (action.type === "add_to_watchlist") {
      if (!watchlistSymbols.includes(target)) await updateWatchlist([...watchlistSymbols, target]);
      return `Added ${target} to your watchlist.`;
    }
    if (action.type === "remove_from_watchlist") {
      if (watchlistSymbols.length > 1) removeInstrument(target);
      return `Removed ${target} from your watchlist.`;
    }
    if (action.type === "set_risk_limits") {
      if (!userPreferences) throw new Error("Your preferences haven't loaded yet.");
      const next = { ...userPreferences };
      if (typeof args.max_trade_risk_percent === "number") next.max_trade_risk_percent = args.max_trade_risk_percent;
      if (typeof args.max_daily_loss_percent === "number") next.max_daily_loss_percent = args.max_daily_loss_percent;
      await saveUserPreferences(next);
      setUserPreferences(next);
      return "Your risk limits are saved.";
    }
    if (action.type === "navigate") {
      setSection(args.section as Section);
      return `Switched to ${String(args.section)}.`;
    }
    if (action.type === "start_walkthrough") {
      setWalkthrough(args.walkthrough as Walkthrough);
      setAssistantOpen(false);
      return "Starting the guided walkthrough.";
    }
    if (action.type === "look_at_screen") {
      await startScreenShare();
      return "Your browser is now sharing this tab with Zuri. Ask me again and I'll look.";
    }
    throw new Error("Zuri doesn't know how to do that yet.");
  };

  // Called only from the trade card's own confirm button; it reuses the same endpoint and server-side checks as the Trade tab.
  const placeZuriTrade = async (action: ZuriAction, phrase: string): Promise<string> => {
    if (!linkedAccount.data) throw new Error("No broker is linked.");
    const { broker_symbol: orderSymbol, side, quantity, stop_loss: stop, take_profit: target } = action.args as { broker_symbol: string; side: string; quantity: number; stop_loss?: number; take_profit?: number };
    const response = await fetch(`${backendUrl}/api/brokers/${linkedAccount.data.broker}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ symbol: orderSymbol, side, quantity, confirmed: true, confirmation_phrase: phrase, ...(stop !== undefined && target !== undefined ? { stop_loss: stop, take_profit: target } : {}) }),
    });
    const body = await response.json().catch(() => ({})) as { detail?: unknown; status?: string; market_open?: boolean; next_open?: string | null; warnings?: string[] };
    if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The order was rejected.");
    linkedAccount.refresh();
    captureScreenForTrade(accessToken, orderSymbol, reloadJournal);
    const waiting = body.market_open === false && body.status !== "filled" ? ` The market is closed, so it will wait${body.next_open ? ` and fill after it opens (${formatOpenTime(body.next_open)} your time)` : " until it opens"}.` : "";
    return `${linkedAccount.data.environment === "live" ? "LIVE" : "Paper"} order sent: ${body.status ?? "submitted"}.${waiting}${Array.isArray(body.warnings) ? ` ${body.warnings.join(" ")}` : ""}`;
  };

  const CHART_STEP_TARGETS = ["chart-timeframes", "chart-panel", "journal-actions", "ai-takeaway", "news-charts", "chart-scanners", "chart-backtest", "chart-backtest-history"];
  const applyStepRef = useRef<(step: WalkthroughStep) => void>(() => undefined);
  useEffect(() => { applyStepRef.current = (step) => {
    setSection(step.section as Section);
    if (watchlistSymbols.length === 0 && CHART_STEP_TARGETS.includes(step.target)) {
      // The user skipped picking a market; open a starter one so these steps have something real to show.
      const interests = Array.isArray(session?.user.user_metadata?.primary_markets) ? (session.user.user_metadata.primary_markets as string[]) : [];
      const starter = instruments.find((item) => interests.includes(item.group)) ?? instruments[0];
      if (starter) addInstrument(starter.symbol);
    }
    if (step.symbol && watchlistSymbols.includes(step.symbol)) setSelectedSymbol(step.symbol);
    if (step.timeframe && timeframes.includes(step.timeframe)) setTimeframe(step.timeframe);
    if (step.prefill?.search !== undefined) setQuery(step.prefill.search);
    if (step.settings_tab || step.prefill?.max_trade_risk_percent !== undefined || step.prefill?.max_daily_loss_percent !== undefined) {
      setSettingsRequest((current) => ({ tab: step.settings_tab, prefill: step.prefill, n: (current?.n ?? 0) + 1 }));
    }
  }; });
  const applyWalkthroughStep = useCallback((step: WalkthroughStep) => applyStepRef.current(step), []);
  const closeWalkthrough = useCallback((finished: boolean) => {
    setWalkthrough((current) => {
      if (current) logZuriEvent(accessToken, finished ? "walkthrough_finished" : "walkthrough_exited", current.title);
      if (current && finished) {
        // What is best next has changed, and after the tour the user lands on Zuri's fresh next move.
        if (current.id === "site_tour") setSection("Dashboard");
        nextStepAt.current = 0;
        window.setTimeout(() => void loadNextStep(), 0);
      }
      return null;
    });
  }, [accessToken, loadNextStep]);

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <a className="brand" href="#charts" onClick={() => setSection("Charts")} aria-label="Zuri home"><Image className="brand-logo" src="/zuri-logo.jpg" alt="" width={768} height={768} priority /><span>zuri<span className="brand-dot">.</span></span></a>
        <div className="top-divider" />
        <div className="market-strip"><span className="live-dot" /> NYSE <span className="strip-separator">/</span> NASDAQ <span className="market-open">{linkedAccount.data ? `${linkedAccount.data.broker_name.toUpperCase()} · ${linkedAccount.data.environment === "live" ? "LIVE" : "PAPER"}` : "NO BROKER LINKED"}</span><MarketClock token={accessToken} enabled={Boolean(linkedAccount.data)} /></div>
        <div className="topbar-right"><span className="zuri-anchor"><button className={`icon-action zuri-top${showOnboarding ? " is-away" : ""}${bubble && !showOnboarding ? " is-speaking" : ""}`} title="Ask Zuri" aria-label="Ask Zuri" onClick={() => setAssistantOpen(true)}><ZuriMascot size={34} /></button>{bubble && !showOnboarding && (
          <div className="zuri-bubble" role="status" aria-label="Message from Zuri">
            <p>{bubble}</p>
            <div className="zuri-bubble-actions">
              <button type="button" onClick={() => { setAssistantDraft(""); setAssistantOpen(true); dismissBubble(); }}>Reply to Zuri</button>
              <button type="button" onClick={() => { dismissBubble(); setOnboardingForced(true); }}>Set me up</button>
              <button type="button" className="muted" onClick={dismissBubble}>Not now</button>
            </div>
          </div>
        )}</span><span className="topbar-email">{session?.user.email}</span><button className="signout-button" onClick={async () => { try { await signOut(); } catch (signOutError) { setAccountError(signOutError instanceof Error ? signOutError.message : "Unable to sign out."); } }}>Sign out</button>{accountError && <span className="topbar-auth-error" role="alert">{accountError}</span>}</div>
      </header>
      <div className={section === "Settings" ? "workspace settings-workspace" : "workspace"}>
        <nav className="primary-nav" aria-label="Primary navigation">
          <div className="nav-main">{(["Charts", "Dashboard", "Trade", "History", "Journal"] as Section[]).map((item) => <button key={item} data-zuri-target={`nav-${item}`} onClick={() => setSection(item)} className={section === item ? "nav-item selected" : "nav-item"} title={item}><Icon name={item}/><span>{item}</span></button>)}</div>
          <div className="nav-bottom"><button data-zuri-target="nav-Settings" onClick={() => setSection("Settings")} className={section === "Settings" ? "nav-item selected" : "nav-item"} title="Settings"><Icon name="Settings"/><span>Settings</span></button></div>
        </nav>
        <div className="content-column">
          <div className="page-heading"><div><div className="eyebrow">PERSONAL TRADING DESK <span>•</span> {deskDate} <span>•</span> <time>{deskTime}</time></div><h1>{section}</h1></div></div>
          {dataError && <div className="auth-error" role="alert">{dataError}</div>}
          {workspaceDataUserId !== session?.user.id ? (
            <div className="content-card"><p>{dataError ? "Your saved workspace data could not be loaded. Please try again after checking the database setup." : "Loading your saved workspace…"}</p></div>
          ) : <>
          {section === "Charts" && watchlistInstruments.length === 0 && (() => {
            const interests = Array.isArray(session?.user.user_metadata?.primary_markets) ? (session!.user.user_metadata.primary_markets as string[]) : [];
            const starters = [...instruments].sort((a, b) => Number(interests.includes(b.group)) - Number(interests.includes(a.group)));
            return <section className="chart-welcome" aria-label="Pick your first market" data-zuri-target="chart-welcome">
              <div className="chart-welcome-head">
                <span className="chart-welcome-spark">✳</span>
                <h2>Your chart desk is ready. Pick a first market.</h2>
                <p>Charts show one market at a time, so your desk starts empty until you choose what to follow. Pick one below to add it to your watchlist and open its chart. You can change it any time.</p>
              </div>
              <div className="chart-welcome-grid">
                {starters.map((item) => <button key={item.symbol} type="button" className="chart-welcome-card" onClick={() => { addInstrument(item.symbol); setSelectedSymbol(item.symbol); }}>
                  <span className={`watch-icon ${item.group.toLowerCase()}`}>{item.icon}</span>
                  <span className="chart-welcome-name"><b>{item.symbol}</b><small>{item.name}</small></span>
                  <span className="chart-welcome-quote"><b>{item.price}</b><small className={item.hasQuote ? (item.up ? "positive" : "negative") : "muted"}>{item.change}</small></span>
                  <span className="chart-welcome-add">{interests.includes(item.group) ? "Your interest · " : ""}Add and open chart →</span>
                </button>)}
              </div>
              <div className="chart-welcome-foot">
                <span>Not sure where to start? Zuri can pick with you.</span>
                <button type="button" className="outline-button" onClick={() => { setAssistantDraft("I'm new and my chart desk is empty. Which market should I start with, and can you open it for me?"); setAssistantOpen(true); }}>Ask Zuri to help me choose</button>
              </div>
            </section>;
          })()}
          {section === "Charts" && watchlistInstruments.length > 0 && <>
            <section className="chart-head">
              <div className="chart-head-symbol"><span className={`watch-icon ${symbol.group.toLowerCase()}`}>{symbol.icon}</span><div><b>{symbol.symbol}</b><small>{symbol.name} · {symbol.group === "Crypto" ? "COINBASE" : "GLOBAL"}</small></div></div>
              <div className="chart-head-price">{symbol.hasQuote ? <><strong>{symbol.price}</strong><span className={symbol.up ? "positive" : "negative"}>{symbol.change} <small>today</small></span></> : <span className="muted">Loading the real quote…</span>}</div>
              <div className="ohlc">{symbol.hasQuote && (symbolDetail === "simple" ? <span>Today&apos;s move <b>{symbol.change}</b></span> : <><span>High <b>{symbol.high ?? "—"}</b></span><span>Low <b>{symbol.low ?? "—"}</b></span>{symbol.volume && <span>Volume <b>{symbol.volume}</b></span>}</>)}</div>
            </section>
            <div className="journal-chart-bar">
              <div className="journal-intervals" data-zuri-target="chart-timeframes" aria-label="Chart interval">{timeframes.map((item) => <button key={item} className={timeframe === item ? "time-button active" : "time-button"} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
              <div className="journal-chart-actions" data-zuri-target="journal-actions">
                <button className="journal-capture-button" onClick={() => { setJournalDraftSide("Watching"); setJournalDraftOpen(true); }}>＋ <span>Note</span></button>
                <button className="journal-plan-button long" onClick={() => { setJournalDraftSide("Long"); setJournalDraftOpen(true); }}>↗ <span>Long plan</span></button>
                <button className="journal-plan-button short" onClick={() => { setJournalDraftSide("Short"); setJournalDraftOpen(true); }}>↘ <span>Short plan</span></button>
                <button className="journal-saved-button" onClick={() => setSection("Journal")}>Journal <span>{journalEntries.length}</span></button>
              </div>
            </div>
            <section className="chart-panel" data-zuri-target="chart-panel"><div className="chart-labels"><span><i className="legend-candle"/> Candles</span><span><i className="legend-line"/> EMA 20</span><span className="chart-label-right">USD <span>⌄</span></span></div><div className="chart-stage"><aside className="drawing-toolbar">{chartTools.slice(0, 9).map((tool, index) => <button key={`${tool}-draw-${index}`} className={activeTool === tool ? "drawing-button chosen" : "drawing-button"} title={`Drawing tool ${index + 1}`} onClick={() => setActiveTool(activeTool === tool ? "" : tool)}>{tool}</button>)}<span className="draw-separator"/><button className="drawing-button" title="Remove drawings" onClick={() => setActiveTool("")}>⌫</button></aside><Chart symbol={symbol} timeframe={timeframe} drawing={activeTool} aiOnChart={aiOnChart}/>            </div></section>
            <p className="chart-caption">Prices from a public market-data feed, delayed by up to 15 minutes</p>
            <section className="ai-takeaway" data-zuri-target="ai-takeaway"><div className="ai-heading"><span className="ai-spark">✳</span><span className="small-label">ZURI · {symbol.symbol} TODAY</span><span className="confidence">REAL QUOTE</span></div><h2>{symbol.hasQuote ? `${symbol.symbol} · ${symbol.up ? "Up" : "Down"} ${symbol.change.replace(/^[+−]/, "")} today` : `${symbol.symbol} · loading`}</h2><p>{aiBrief}</p><div className="ai-foot"><span>Based on the real day quote</span><div className="ai-foot-actions"><button className="news-link" aria-pressed={aiOnChart} onClick={() => setAiOnChart(!aiOnChart)}>{aiOnChart ? "Hide chart context" : "Add to chart"}</button><button className="text-action" onClick={() => { setAssistantDraft(`Please analyse the ${symbol.symbol} chart for me.`); setAssistantOpen(true); }}>Ask Zuri for a full analysis →</button></div></div></section>
            {journalDraftOpen && <JournalCapture symbol={symbol} timeframe={timeframe} initialSide={journalDraftSide} onSave={saveJournalEntry} onCancel={() => setJournalDraftOpen(false)} />}
          </>}
          {section === "Dashboard" && (
            <Dashboard
              userId={userId}
              fallbackName={typeof session?.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name : ""}
              hero={journey?.phase === "done" ? (
                <section className="content-card zuri-next" data-zuri-target="zuri-next">
                  <ZuriMascot mood="idle" size={56} />
                  <div className="zuri-next-body">
                    <div className="section-title"><div><span className="small-label">ZURI · YOUR BEST NEXT MOVE</span><h2>{nextStep ? nextStep.primary.headline : nextStepError ? "I couldn't decide just now" : "Thinking about what's best for you…"}</h2></div><button className="text-action" disabled={nextStepBusy} onClick={() => void loadNextStep()}>{nextStepBusy ? "Thinking…" : "Re-check ↻"}</button></div>
                    {nextStep && <>
                      <p>{nextStep.primary.why}</p>
                      <div className="zuri-next-actions">
                        <button type="button" className="zuri-next-primary" onClick={() => runNextStep(nextStep.primary)}>{nextStep.primary.walkthrough ? "Do it with me" : "Talk it through"}</button>
                        {nextStep.alternatives.map((item) => <button key={item.headline} type="button" className="zuri-next-alt" onClick={() => runNextStep(item)}>{item.headline}</button>)}
                      </div>
                    </>}
                    {nextStepError && <p className="muted">{nextStepError}</p>}
                  </div>
                </section>
              ) : null}
              setSection={setSection}
              news={marketNews}
              loading={marketNewsLoading}
              error={marketNewsError}
              onRefresh={() => {
                setMarketNewsLoading(true);
                setMarketNewsRefresh((value) => value + 1);
              }}
              onAskAboutStory={askZuriAboutNews}
              linked={linkedAccount}
              token={accessToken}
              refreshKey={journalRefresh}
              checklist={null}
            />
          )}
          {section === "Trade" && <TradeView symbol={symbol} instruments={instruments} orderSide={orderSide} setOrderSide={setOrderSide} linked={linkedAccount} token={session?.access_token ?? ""} onTraded={reloadJournal} riskPercent={userPreferences?.max_trade_risk_percent ?? 1}/>}
          {section === "History" && <HistoryView linked={linkedAccount} token={accessToken} refreshKey={journalRefresh} />}
          {section === "Journal" && <JournalView entries={journalEntries} token={accessToken} refreshKey={journalRefresh} onReload={reloadJournal} onNewEntry={() => { setSection("Charts"); setJournalDraftSide("Watching"); setJournalDraftOpen(true); }} onDelete={(id) => void removeJournalEntry(id)} />}
          {section === "Settings" && session && <SettingsView token={accessToken} request={settingsRequest} linked={linkedAccount} userId={session.user.id} email={session.user.email ?? ""} preferences={userPreferences} onSavePreferences={async (preferences) => {
            await saveUserPreferences(preferences);
            const previous = userPreferences;
            setUserPreferences(preferences);
            // Only a changed default moves the chart; unrelated settings must not reset what you're looking at.
            if (previous && previous.default_timeframe !== preferences.default_timeframe) setTimeframe(preferences.default_timeframe);
            if (previous && previous.default_symbol !== preferences.default_symbol && watchlistSymbols.includes(preferences.default_symbol)) setSelectedSymbol(preferences.default_symbol);
          }} />}
          {session && workspaceDataUserId === session.user.id && <ChartResearch
            symbol={symbol.symbol}
            timeframe={timeframe}
            broker={linkedAccount.data?.broker ?? ""}
            token={accessToken}
            userId={session.user.id}
            eventContext={backtestNewsContext}
            onClearEventContext={() => setBacktestNewsContext(null)}
            visible={section === "Charts" && watchlistInstruments.length > 0}
          />}
          </>}
        </div>
        {section !== "Settings" && <aside data-zuri-target="quotes-rail" className={watchlistOpen ? "right-rail" : "right-rail collapsed"}>
          <div className="rail-head"><div><h2>Quotes</h2><span className="rail-count"><i className="quote-live-dot"/> {watchlistInstruments.length} symbols · delayed ≤15 min</span></div></div>
          {watchlistOpen && <>
            <label className="search-box" data-zuri-target="market-search"><span>⌕</span><input id="market-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quotes"/><kbd>/</kbd></label>
            <div className="watchlist-columns"><span>SYMBOL</span><span>PRICE</span><span>CHANGE</span></div>
            <div className="watchlist-items">
              {layoutActive && layout?.mode === "tabs" && <div className="market-tabs" role="tablist" aria-label="Markets">{marketOrder.map((market) => <button key={market} role="tab" aria-selected={activeMarket === market} className={activeMarket === market ? "market-tab active" : "market-tab"} onClick={() => setMarketTab(market)}>{market} <small>{filteredInstruments.filter((item) => item.group === market).length}</small></button>)}</div>}
              {layoutActive && layout?.mode === "sections"
                ? marketOrder.map((market) => {
                    const open = openMarkets[market] ?? !(layout?.markets.find((entry) => entry.market === market)?.collapsed);
                    return <div key={market} className="market-section"><button className="market-section-head" aria-expanded={open} onClick={() => setOpenMarkets((current) => ({ ...current, [market]: !open }))}><span>{open ? "▾" : "▸"} {market}</span><small>{filteredInstruments.filter((item) => item.group === market).length}</small></button>{open && filteredInstruments.filter((item) => item.group === market).map(renderQuoteRow)}</div>;
                  })
                : (layoutActive && layout?.mode === "tabs" ? filteredInstruments.filter((item) => item.group === activeMarket) : filteredInstruments).map(renderQuoteRow)}
              {filteredInstruments.length === 0 && <div className="empty-search">{watchlistSymbols.length === 0 && !query ? "Your watchlist is empty. Search to add symbols." : "No matching markets"}</div>}
            </div>
            <div className="rail-section-heading"><span>{section === "Charts" ? "MARKET NEWS" : "ZURI AI OVERVIEW"}</span><span className="live-dot"/></div>
            {watchlistInstruments.length === 0 ? (
              <section className="rail-empty">
                <h3>Pick a market first</h3>
                <p>Once you choose a market, Zuri shows its live read and the headlines that matter to it here.</p>
                <button className="outline-button" onClick={() => setSection("Charts")}>Choose a market →</button>
              </section>
            ) : <>
            {section !== "Charts" && <section className="ai-overview-card">
              <div className="ai-overview-header">
                <div className="ai-badge"><span className="ai-badge-mark">✦</span><span>ZURI AI</span></div>
                <span className="ai-overview-status">{symbol.hasQuote ? "REAL QUOTE" : "WAITING"}</span>
              </div>
              <h3>{symbol.symbol} today</h3>
              <p>{aiBrief}</p>
              <div className="ai-overview-grid">
                <div className="ai-metric"><span>Change</span><strong className={symbol.hasQuote ? (symbol.up ? "positive" : "negative") : ""}>{symbol.change}</strong></div>
                <div className="ai-metric"><span>Price</span><strong>{symbol.price}</strong></div>
                {symbolDetail === "full" && <><div className="ai-metric"><span>Day high</span><strong>{symbol.high ?? "—"}</strong></div>
                <div className="ai-metric"><span>Day low</span><strong>{symbol.low ?? "—"}</strong></div></>}
              </div>
              <div className="ai-overview-actions">
                <button className="news-link" aria-pressed={aiOnChart} onClick={() => setAiOnChart(!aiOnChart)}>{aiOnChart ? "Hide chart context" : "Add to chart"}</button>
                <button className="text-action" onClick={() => { setAssistantDraft(`Please analyse the ${symbol.symbol} chart for me.`); setAssistantOpen(true); }}>Deep dive →</button>
              </div>
            </section>}
            <MarketNewsSection
              variant="charts"
              symbol={symbol.symbol}
              news={marketNews}
              loading={marketNewsLoading}
              error={marketNewsError}
              onRefresh={() => setMarketNewsRefresh((value) => value + 1)}
              onAskAboutStory={askZuriAboutNews}
              onBacktestStory={useNewsForBacktest}
            />
            </>}
          </>}
        </aside>}
      </div>
      <footer className="statusbar"><span><i className="live-dot"/> All systems operational</span><span>{linkedAccount.data ? (linkedAccount.data.environment === "live" ? "Live trading" : "Paper trading") : "Trading"} <b>{linkedAccount.data ? "ON" : "OFF"}</b></span><span>Prices in USD</span><span className="status-spacer"/></footer>
      {showOnboarding && journey && (
        <ZuriOnboarding
          accessToken={accessToken}
          initialSee={zuriAccess.see}
          initialAct={zuriAccess.act}
          onFinish={finishOnboarding}
          onSkip={() => { setOnboardingForced(false); updateJourney({ ...journey, phase: "done", mode: "assistant", completed_steps: [...new Set([...journey.completed_steps, "guide:skipped"])] }); }}
        />
      )}
      {journey?.phase === "done" && !journey.completed_steps.includes("guide:skipped") && !journey.completed_steps.includes("guide:done") && (
        <ZuriGuide accessToken={session?.access_token ?? ""} section={section} journey={journey} onJourney={updateJourney} setSection={setSection} />
      )}
      <AuraAssistant
        section={section}
        symbol={symbol}
        timeframe={timeframe}
        accessToken={session?.access_token ?? ""}
        newsRequest={assistantNewsRequest}
        onClearNewsRequest={() => setAssistantNewsRequest(null)}
        isOpen={assistantOpen}
        onOpenChange={setAssistantOpen}
        draft={assistantDraft}
        setDraft={setAssistantDraft}
        access={zuriAccess}
        onAccess={updateZuriAccess}
        buildScreen={buildScreenState}
        executeAction={executeZuriAction}
        placeTrade={placeZuriTrade}
        broker={linkedAccount.data?.broker_name ?? null}
        environment={linkedAccount.data?.environment ?? null}
        riskLimit={userPreferences?.max_trade_risk_percent ?? null}
        nudges={visibleNudges}
        onDismissNudge={dismissNudge}
        involvement={involvement}
        onInvolvement={changeInvolvement}
      />
      {walkthrough && <ZuriTakeover walkthrough={walkthrough} watchlistEmpty={watchlistSymbols.length === 0} brokerLinked={Boolean(linkedAccount.data)} onApplyStep={applyWalkthroughStep} onClose={closeWalkthrough} />}
    </main>
  );
}

type AuraChatMessage = { id: string; role: "user" | "assistant"; content: string };

function AuraAssistant({
  section,
  symbol,
  timeframe,
  accessToken,
  newsRequest,
  onClearNewsRequest,
  isOpen,
  onOpenChange,
  draft,
  setDraft,
  access,
  onAccess,
  buildScreen,
  executeAction,
  placeTrade,
  broker,
  environment,
  riskLimit,
  nudges,
  onDismissNudge,
  involvement,
  onInvolvement,
}: {
  section: Section;
  symbol: Instrument;
  timeframe: string;
  accessToken: string;
  newsRequest: { article: MarketNewsArticle } | null;
  onClearNewsRequest: () => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  setDraft: (draft: string) => void;
  access: { see: boolean; act: boolean };
  onAccess: (patch: Partial<{ see: boolean; act: boolean }>) => void;
  buildScreen: () => Record<string, unknown>;
  executeAction: (action: ZuriAction) => Promise<string>;
  placeTrade: (action: ZuriAction, phrase: string) => Promise<string>;
  broker: string | null;
  environment: "paper" | "live" | null;
  riskLimit: number | null;
  nudges: ZuriNudge[];
  onDismissNudge: (id: string) => void;
  involvement: Involvement;
  onInvolvement: (value: Involvement) => void;
}) {
  const [messages, setMessages] = useState<AuraChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi, I'm Zuri. I can help you think through a trade plan, understand risk, or explain a trading concept. What are you working on?",
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ZuriAction[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const sharing = useScreenShareActive();
  const topNudge = nudges[0] ?? null;
  const selectedNewsArticle = newsRequest?.article ?? null;
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [isOpen, messages, isSending, error]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onOpenChange]);

  const sendMessage = async (content: string) => {
    const text = content.trim();
    if (!text || isSending) return;

    const userMessage: AuraChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const conversation = [
      ...messages.filter((message) => message.id !== "welcome").slice(-14),
      userMessage,
    ].map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError("");
    setPending([]);
    setIsSending(true);

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const screenshot = access.see && sharing ? grabScreenFrame() : null;
      const response = await fetch(`${backendUrl}/api/assistant/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: conversation,
          ...(screenshot ? { screenshot } : {}),
          context: {
            section,
            symbol: symbol.symbol,
            timeframe,
            permissions: { see_workspace: access.see, act: access.act },
            ...(access.see ? { screen: buildScreen() } : {}),
            news_article: selectedNewsArticle ? {
              title: selectedNewsArticle.title,
              summary: selectedNewsArticle.summary,
              source: selectedNewsArticle.source,
              published_at: selectedNewsArticle.published_at,
              url: selectedNewsArticle.url,
            } : null,
          },
        }),
      });
      const result = await response.json() as { reply?: unknown; detail?: unknown; actions?: ZuriAction[] };
      if (!response.ok) {
        throw new Error(typeof result.detail === "string" ? result.detail : `AI request failed (${response.status}).`);
      }
      const reply = result.reply;
      if (typeof reply !== "string" || !reply.trim()) {
        throw new Error("Zuri returned an empty reply. Please try again.");
      }
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: reply },
      ]);
      if (access.act && Array.isArray(result.actions)) setPending(result.actions.map((action) => ({ ...action, at: Date.now() })));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reach Zuri AI.");
    } finally {
      setIsSending(false);
    }
  };

  const decideAction = async (action: ZuriAction, approve: boolean) => {
    setPending((current) => current.filter((item) => item.id !== action.id));
    if (!approve) {
      logZuriEvent(accessToken, "declined", action.label);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "No problem, I won't do that." }]);
      return;
    }
    try {
      const outcome = await executeAction(action);
      logZuriEvent(accessToken, "approved", action.label);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `Done. ${outcome}` }]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "That action didn't work.");
    }
  };

  const openNudge = (nudge: ZuriNudge) => {
    logZuriEvent(accessToken, "nudge_opened", nudge.title);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `${nudge.title}. ${nudge.body}` }]);
    onDismissNudge(nudge.id);
    onOpenChange(true);
  };

  return (
    <div className="aura-assistant">
      {!isOpen && topNudge && (
        <div className={`aura-nudge ${topNudge.severity}`} role="status">
          <button type="button" className="aura-nudge-body" onClick={() => openNudge(topNudge)}>
            <strong>{topNudge.title}</strong>
            <span>{topNudge.body}</span>
          </button>
          <button type="button" aria-label="Dismiss notice" onClick={() => onDismissNudge(topNudge.id)}>×</button>
        </div>
      )}
      {isOpen && (
        <section className="aura-panel" aria-label="Zuri AI trading companion">
          <header className="aura-panel-header">
            <span className="aura-orb aura-orb-small" aria-hidden="true"><span>✦</span></span>
            <div className="aura-panel-title">
              <strong>Zuri <span>AI</span></strong>
              <small>{isSending ? "Thinking…" : "Your trading buddy"}</small>
            </div>
            <button className={`aura-icon-btn${showSettings ? " active" : ""}`} type="button" aria-label="What Zuri can see and do" aria-expanded={showSettings} onClick={() => setShowSettings((value) => !value)}>⚙</button>
            <button className="aura-close" type="button" aria-label="Close Zuri AI" onClick={() => onOpenChange(false)}>×</button>
          </header>
          <div className="aura-context">
            <span className="aura-chip">{section}</span>
            <span className="aura-chip">{symbol.symbol}</span>
            <span className="aura-chip">{timeframe}</span>
            <span className={`aura-chip ${access.see ? "on" : ""}`}>{access.see ? "Can see screen" : "Screen hidden"}</span>
          </div>
          {showSettings && (
            <div className="aura-access" aria-label="What Zuri may do">
              <label><input type="checkbox" checked={access.see} onChange={(event) => onAccess({ see: event.target.checked })} /> <span><b>See my workspace</b><small>Chart, positions and what you have open</small></span></label>
              <label><input type="checkbox" checked={access.act} onChange={(event) => onAccess({ act: event.target.checked })} /> <span><b>Act for me</b><small>I approve every step first</small></span></label>
              {access.see && <button type="button" className="aura-share" onClick={() => void startScreenShare().catch((shareError: unknown) => setError(shareError instanceof Error ? shareError.message : "Screen sharing was cancelled."))} disabled={sharing}>{sharing ? "Seeing your screen" : "Show Zuri my screen"}</button>}
              <label className="aura-involve"><span><b>How involved I am</b></span><select value={involvement} onChange={(event) => onInvolvement(event.target.value as Involvement)}>
                <option value="side_by_side">Side-by-side buddy</option>
                <option value="occasional">Occasional buddy</option>
                <option value="on_demand">Need-to-know buddy</option>
              </select></label>
            </div>
          )}
          {selectedNewsArticle && (
            <div className="aura-news-context">
              <span>DISCUSSING NEWS · {selectedNewsArticle.source}</span>
              <a href={selectedNewsArticle.url} target="_blank" rel="noreferrer">{selectedNewsArticle.title}</a>
              <button type="button" onClick={onClearNewsRequest} aria-label="Clear selected news context">×</button>
            </div>
          )}
          <div className="aura-messages" ref={messageListRef} aria-live="polite">
            {messages.map((message) => (
              <div className={`aura-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="aura-message-mark" aria-hidden="true">✦</span>}
                <p>{message.content}</p>
              </div>
            ))}
            {isSending && <div className="aura-typing" role="status"><span /><span /><span /> Zuri is thinking</div>}
            {pending.map((action) => action.type === "propose_trade" ? (
              <ZuriTradeCard
                key={action.id}
                action={action}
                broker={broker}
                environment={environment}
                riskLimit={riskLimit}
                onCancel={() => void decideAction(action, false)}
                onConfirm={async (phrase) => {
                  setPending((current) => current.filter((item) => item.id !== action.id));
                  try {
                    const outcome = await placeTrade(action, phrase);
                    logZuriEvent(accessToken, "approved", `Order confirmed by user: ${action.label}`);
                    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: outcome }]);
                  } catch (tradeError) {
                    logZuriEvent(accessToken, "declined", `Order failed: ${action.label}`);
                    setError(tradeError instanceof Error ? tradeError.message : "The order failed.");
                  }
                }}
              />
            ) : (
              <div className="aura-action" key={action.id}>
                <span>ZURI WANTS TO</span>
                <strong>{action.label}</strong>
                <div><button type="button" className="approve" onClick={() => void decideAction(action, true)}>Approve</button><button type="button" onClick={() => void decideAction(action, false)}>Not now</button></div>
              </div>
            ))}
            {error && <p className="aura-error" role="alert">{error}</p>}
          </div>
          {messages.length === 1 && (
            <div className="aura-suggestions">
              <button type="button" onClick={() => void sendMessage(`Open the ${symbol.symbol} chart and walk me through what it shows.`)}><b>Read {symbol.symbol} with me</b><span>Chart analysis, step by step</span></button>
              <button type="button" onClick={() => void sendMessage("What is the best next step for me right now?")}><b>What should I do next?</b><span>Based on where you are</span></button>
              <button type="button" onClick={() => void sendMessage("Explain stop-loss and position size like I'm new to trading.")}><b>Learn risk basics</b><span>Stop-loss and position size</span></button>
              <button type="button" onClick={() => void sendMessage(`Help me create a risk checklist for ${symbol.symbol}.`)}><b>Build a risk checklist</b><span>Before I place a trade</span></button>
            </div>
          )}
          <form className="aura-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage(draft); }}>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Zuri about your trading plan..."
              aria-label="Message Zuri AI"
              rows={2}
              maxLength={2000}
              disabled={isSending}
            />
            <button type="submit" aria-label="Send message" disabled={!draft.trim() || isSending}>↑</button>
          </form>
          <p className="aura-disclaimer">{access.act ? "Zuri only acts after you approve · no trades are submitted" : "Educational support only · no trades are submitted"}</p>
        </section>
      )}
    </div>
  );
}

function JournalCapture({ symbol, timeframe, initialSide, onSave, onCancel }: { symbol: Instrument; timeframe: string; initialSide: JournalSide; onSave: (entry: Omit<JournalEntry, "id" | "createdAt" | "source">) => void | Promise<void>; onCancel: () => void }) {
  return (
    <section className="journal-capture" aria-labelledby="journal-capture-title">
      <div className="journal-capture-heading"><div><span className="small-label">CHART JOURNAL · {symbol.symbol} · {timeframe}</span><h2 id="journal-capture-title">Capture your plan</h2></div><button className="icon-action" title="Close journal capture" onClick={onCancel}>×</button></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSave({ symbol: symbol.symbol, timeframe, side: String(form.get("side")) as JournalSide, setup: String(form.get("setup")), entry: String(form.get("entry")), stop: String(form.get("stop")), target: String(form.get("target")), note: String(form.get("note")).trim() });
      }}>
        <div className="journal-fields">
          <label className="field-label">Setup<select name="setup" defaultValue="Trade idea"><option>Trade idea</option><option>Pre-trade plan</option><option>Entry review</option><option>Exit review</option><option>Post-trade lesson</option></select></label>
          <label className="field-label">Direction<select name="side" defaultValue={initialSide}><option>Watching</option><option>Long</option><option>Short</option></select></label>
          <label className="field-label">Entry price<input name="entry" inputMode="decimal" placeholder="Optional" /></label>
          <label className="field-label">Stop loss<input name="stop" inputMode="decimal" placeholder="Optional" /></label>
          <label className="field-label">Target price<input name="target" inputMode="decimal" placeholder="Optional" /></label>
        </div>
        <label className="field-label journal-note-field">Thesis and notes<textarea name="note" required rows={3} placeholder="What is the setup, what confirms it, and what invalidates it?" /></label>
        <div className="journal-capture-footer"><span>Saved to your account · chart drawings are not attached</span><div><button type="button" className="outline-button" onClick={onCancel}>Cancel</button><button type="submit" className="solid-button">Save to journal</button></div></div>
      </form>
    </section>
  );
}

function JournalView({ entries, token, refreshKey, onReload, onNewEntry, onDelete }: { entries: JournalEntry[]; token: string; refreshKey: number; onReload: () => void; onNewEntry: () => void; onDelete: (id: string) => void }) {
  const [draftingId, setDraftingId] = useState("");
  const [draftError, setDraftError] = useState("");
  const draftNote = async (id: string) => {
    setDraftingId(id);
    setDraftError("");
    try {
      await draftJournalNote(token, id);
      onReload();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Zuri could not draft this note.");
    } finally {
      setDraftingId("");
    }
  };
  return (
    <div className="secondary-view journal-view">
      <div className="section-title journal-view-heading"><div className="journal-toolbar-meta"><span className="small-label">AUTOMATIC JOURNEY TRACKING · SAVED TO YOUR ACCOUNT</span><span className="journal-count"><b>{entries.length}</b> {entries.length === 1 ? "entry" : "entries"}<i>·</i><b>{entries.filter((entry) => entry.source === "auto").length}</b> auto-captured</span></div><button className="solid-button" onClick={onNewEntry}>＋ <span>New entry</span></button></div>
      <JournalInsights token={token} refreshKey={refreshKey} onEntriesChanged={onReload} />
      {draftError && <p className="auth-message" role="alert">{draftError}</p>}
      {entries.length === 0 ? <div className="content-card journal-empty"><span className="small-label">NO ENTRIES YET</span><h3>Start with a chart idea</h3><p>Capture a setup, define your risk, and write down what would invalidate the trade.</p><button className="outline-button" onClick={onNewEntry}>Open chart and write a note</button></div> : <div className="journal-entry-list">{entries.map((entry) => <article className="content-card journal-entry" key={entry.id}>
        <div className="journal-entry-heading"><div><span className="small-label">{entry.setup} · {entry.timeframe}</span><h3>{entry.symbol} <span className={`side-pill ${entry.side === "Short" ? "short" : entry.side === "Long" ? "long" : "watching"}`}>{entry.side}</span></h3></div><div className="journal-entry-actions"><time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time><button className="text-action" onClick={() => onDelete(entry.id)} aria-label={`Delete ${entry.symbol} journal entry`}>Delete</button></div></div>
        <p>{entry.note}</p>
        {entry.source === "auto" && <div className="journal-auto-row"><span className="auto-pill">AUTO-CAPTURED</span><button className="outline-button" disabled={draftingId === entry.id} onClick={() => void draftNote(entry.id)}>{draftingId === entry.id ? "Zuri is writing…" : "Ask Zuri to write the note"}</button></div>}
        {entry.source === "auto" && <SnapshotGallery token={token} refreshKey={refreshKey} entryId={entry.id} showControls={false} />}
        <div className="journal-plan-values"><span>Entry <b>{entry.entry || "—"}</b></span><span>Stop <b>{entry.stop || "—"}</b></span><span>Target <b>{entry.target || "—"}</b></span></div>
      </article>)}</div>}
    </div>
  );
}

function MarketNewsSection({
  variant,
  symbol,
  news,
  loading,
  error,
  onRefresh,
  onAskAboutStory,
  onBacktestStory,
}: {
  variant: "charts" | "dashboard";
  symbol?: string;
  news: MarketNewsResponse | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onAskAboutStory: (article: MarketNewsArticle) => void;
  onBacktestStory?: (article: MarketNewsArticle) => void;
}) {
  const [newsCategory, setNewsCategory] = useState<"trading" | "world">("trading");
  const visibleArticles = (news?.articles ?? [])
    .filter((article) => variant === "dashboard"
      || (article.category === newsCategory && (article.market_wide || article.related_symbols.includes(symbol ?? ""))))
    .slice(0, variant === "dashboard" ? 8 : 6);

  return (
    <section className={`market-news-panel ${variant}`} aria-labelledby={`market-news-title-${variant}`} data-zuri-target={`news-${variant}`}>
      <div className="market-news-heading">
        <div>
          <span className="small-label">ZURI MARKET INTELLIGENCE</span>
          <h2 id={`market-news-title-${variant}`}>{variant === "charts" ? `You should know · ${symbol}` : "Global & watchlist briefing"}</h2>
          <p>{variant === "charts" ? "Trading headlines and relevant world events, with source links." : "External events and reporting that may matter to your markets."}</p>
        </div>
        <button className="news-refresh" type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh market news" title="Refresh market news">↻</button>
      </div>
      {variant === "charts" && <div className="market-news-tabs" role="tablist" aria-label="Briefing category">
        <button type="button" role="tab" aria-selected={newsCategory === "trading"} className={newsCategory === "trading" ? "active" : ""} onClick={() => setNewsCategory("trading")}>Trading world</button>
        <button type="button" role="tab" aria-selected={newsCategory === "world"} className={newsCategory === "world" ? "active" : ""} onClick={() => setNewsCategory("world")}>Relevant world news</button>
      </div>}
      {news?.warnings.length ? <p className="market-news-warning">Some sources are temporarily unavailable: {news.warnings.join(", ")}.</p> : null}
      {error && !news ? <div className="market-news-state error" role="alert">{error}</div> : null}
      {error && news ? <p className="market-news-warning" role="status">Could not refresh the briefing; showing previously loaded stories. {error}</p> : null}
      {loading && !news ? <div className="market-news-state">Loading current headlines from the news sources…</div> : null}
      {!loading && !error && visibleArticles.length === 0 ? (
        <div className="market-news-state">No matching recent headlines were found in this category. Try refreshing later.</div>
      ) : null}
      <div className="market-news-list">
        {visibleArticles.map((article) => (
          <article className="market-news-story" key={article.id}>
            <div className="market-news-meta">
              <span className="market-news-source">{article.source}</span>
              <time dateTime={article.published_at ?? undefined}>
                {article.published_at
                  ? formatDateTime(article.published_at, { dateStyle: "medium", timeStyle: "short" })
                  : "Publication time unavailable"}
              </time>
              {article.market_wide && <span className="market-news-tag global">GLOBAL</span>}
              {article.related_symbols.map((relatedSymbol) => <span className="market-news-tag" key={relatedSymbol}>{relatedSymbol}</span>)}
            </div>
            <a className="market-news-title-link" href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
            {article.summary && <p>{article.summary}</p>}
            <div className="market-news-actions">
              <button type="button" onClick={() => onAskAboutStory(article)}>Ask Zuri what this could mean →</button>
              {variant === "charts" && onBacktestStory && <button type="button" onClick={() => onBacktestStory(article)}>Use for backtest</button>}
              <a href={article.url} target="_blank" rel="noreferrer" aria-label={`Read source article: ${article.title}`}>Read source ↗</a>
            </div>
          </article>
        ))}
      </div>
      <div className="market-news-footer">
        <span>Sources: CNBC, BBC · headlines and excerpts link to publishers</span>
        {news && <span>Updated {formatDateTime(news.fetched_at, { hour: "2-digit", minute: "2-digit" })} · refreshes every 5 min</span>}
      </div>
      <p className="market-news-disclaimer">Headlines are not forecasts. Zuri’s explanation is an AI interpretation, not a prediction or financial advice.</p>
    </section>
  );
}

function Dashboard({
  hero,
  setSection,
  news,
  loading,
  error,
  onRefresh,
  onAskAboutStory,
  linked,
  checklist,
  token,
  refreshKey,
  userId,
  fallbackName,
}: {
  userId?: string;
  fallbackName: string;
  hero: React.ReactNode;
  checklist: React.ReactNode;
  token: string;
  refreshKey: number;
  setSection: (section: Section) => void;
  news: MarketNewsResponse | null;
  linked: LinkedAccountState;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onAskAboutStory: (article: MarketNewsArticle) => void;
}) {
  const [greetingDate] = useState(() => new Date());
  const hour = greetingDate.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const [savedName, setSavedName] = useState("");
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadUserProfile(userId).then((loaded) => { if (!cancelled) setSavedName(loaded.display_name ?? ""); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);
  const firstName = (savedName || fallbackName).trim().split(/\s+/)[0] ?? "";
  return (
    <div className="secondary-view dashboard-view">
      <div className="dashboard-greeting">
        <div><h2>{greeting}{firstName ? <>, <span className="greeting-name">{firstName}</span></> : ""}</h2><p>Here’s the signal behind your numbers today.</p></div>
      </div>
      {hero}
      {checklist}
      {linked.status !== "ready" ? (
        <section className="content-card">
          <div className="section-title"><div><span className="small-label">BROKER ACCOUNT</span><h2>{linked.status === "loading" ? "Loading your account…" : linked.status === "none" ? "No broker linked yet" : "Account unavailable"}</h2></div></div>
          <p className="muted">{linked.status === "none" ? "Link a live or paper broker account to see your real balances and positions here." : linked.error}</p>
          <button className="outline-button" onClick={() => setSection("Settings")}>Open Settings → Broker →</button>
        </section>
      ) : linked.data && (() => {
        const { account, positions, broker_name: brokerName, environment } = linked.data;
        const floating = positions.reduce((sum, position) => sum + (position.unrealized_pl ?? 0), 0);
        return (
          <>
            <div className="stat-grid">
              <Metric label={`Net liquidation · ${brokerName} ${environment === "live" ? "LIVE" : "paper"}`} value={formatMoney(account.equity, account.currency)} change={account.label ?? ""}/>
              <Metric label="Cash" value={formatMoney(account.cash, account.currency)} change="Available balance"/>
              <Metric label="Buying power" value={formatMoney(account.buying_power, account.currency)} change="Reported by broker"/>
              <Metric label="Open positions" value={String(positions.length)} change={`${floating >= 0 ? "+" : "-"}${formatMoney(Math.abs(floating), account.currency)} floating`}/>
            </div>
            <section className="content-card positions-card">
              <div className="section-title"><div><span className="small-label">ACCOUNT</span><h2>Open positions</h2></div><button className="text-action" onClick={() => setSection("Trade")}>Trade →</button></div>
              <PositionsTable positions={positions} currency={account.currency} />
            </section>
          </>
        );
      })()}
      <CoachingPanel token={token} refreshKey={refreshKey} />
      <MarketNewsSection variant="dashboard" news={news} loading={loading} error={error} onRefresh={onRefresh} onAskAboutStory={onAskAboutStory} />
    </div>
  );
}
function Metric({ label, value, change }: { label: string; value: string; change: string }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small className={change.startsWith("+") ? "positive" : "muted"}>{change}</small></div>; }
function alpacaEquivalent(broker: string | undefined, symbol: string) {
  return broker === "alpaca" && ["GOLD", "XAUUSD"].includes(symbol.trim().toUpperCase()) ? "GLD" : symbol;
}
function TradeView({ symbol, instruments, orderSide, setOrderSide, linked, token, onTraded, riskPercent }: { symbol: Instrument; instruments: Instrument[]; orderSide: "Buy" | "Sell"; setOrderSide: (side: "Buy" | "Sell") => void; linked: LinkedAccountState; token: string; onTraded: () => void; riskPercent: number }) {
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [tradeBase, setTradeSymbol] = useState(symbol);
  const tradeSymbol = instruments.find((item) => item.symbol === tradeBase.symbol) ?? tradeBase;
  const [rawOrderSymbol, setOrderSymbol] = useState(symbol.symbol);
  const orderSymbol = alpacaEquivalent(linked.data?.broker, rawOrderSymbol);
  const symbolSwapped = orderSymbol !== rawOrderSymbol;
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState(plainPrice(symbol.price));
  const [confirmed, setConfirmed] = useState(false);
  const [livePhrase, setLivePhrase] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const marketStatus = useMarketStatus(token, Boolean(linked.data), orderSymbol);
  const marketClosed = Boolean(marketStatus?.available && marketStatus.is_open === false);
  const marketQueues = marketStatus?.queues !== false;
  const marketName = marketStatus?.market ?? "market";
  const reopens = formatOpenTime(marketStatus?.next_open);
  const [orderError, setOrderError] = useState("");
  const [coachOn, setCoachOn] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("zuri-first-trade-coach") !== "done");
  const [coachStep, setCoachStep] = useState(() => (typeof window !== "undefined" ? Number(window.localStorage.getItem("zuri-first-trade-step")) || 0 : 0));
  const [coachPlaced, setCoachPlaced] = useState(false);
  const [levelsBusy, setLevelsBusy] = useState(false);
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  const [closingSymbol, setClosingSymbol] = useState("");
  const [closeMessage, setCloseMessage] = useState("");
  const [closeError, setCloseError] = useState("");
  async function closePosition(position: LinkedPosition) {
    if (!linked.data || !position.symbol) return;
    const long = (position.side ?? "long") === "long";
    if (!window.confirm(`Close your ${long ? "long" : "short"} ${position.quantity ?? ""} ${position.symbol} position at the current market price? This ${long ? "sells" : "buys back"} everything you hold in it.`)) return;
    let phrase = "";
    if (linked.data.environment === "live") {
      phrase = window.prompt('This is a LIVE account. Type CONFIRM LIVE to close this position:') ?? "";
      if (!phrase) return;
    }
    setClosingSymbol(position.symbol);
    setCloseError("");
    setCloseMessage("");
    try {
      const query = phrase ? `&confirmation_phrase=${encodeURIComponent(phrase)}` : "";
      const response = await fetch(`${backendUrl}/api/positions/${encodeURIComponent(position.symbol)}?broker=${linked.data.broker}${query}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The position could not be closed.");
      const sameAsTicket = position.symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === orderSymbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      setCloseMessage(sameAsTicket && marketClosed && marketQueues ? `Closing order sent for ${position.symbol}. The market is closed, so your broker will hold it until the next open and it can wait under Pending orders.` : `Closing order sent for ${position.symbol}. If it doesn't fill straight away, check Pending orders.`);
      setOrdersRefresh((value) => value + 1);
      linked.refresh();
      onTraded();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "The position could not be closed.");
      linked.refresh();
    } finally {
      setClosingSymbol("");
    }
  }
  const [levelsNote, setLevelsNote] = useState("");
  const [coachAsked, setCoachAsked] = useState(false);
  const showCoach = coachOn && Boolean(linked.data) && (coachAsked || coachPlaced || coachStep > 0 || (linked.data?.positions.length ?? 0) === 0);
  const focusClass = (step: number) => (showCoach && !coachPlaced && coachStep === step ? " coach-focus" : "");
  function moveCoach(step: number) {
    setCoachStep(step);
    window.localStorage.setItem("zuri-first-trade-step", String(step));
  }
  function closeCoach(finished: boolean) {
    setCoachOn(false);
    setCoachPlaced(false);
    if (finished) window.localStorage.setItem("zuri-first-trade-coach", "done");
  }
  function openCoach() {
    window.localStorage.removeItem("zuri-first-trade-coach");
    window.localStorage.removeItem("zuri-first-trade-step");
    setCoachStep(0);
    setCoachPlaced(false);
    setCoachAsked(true);
    setCoachOn(true);
  }
  async function askZuriForLevels() {
    if (!linked.data || !orderSymbol.trim()) {
      setLevelsNote("Choose a symbol first (step 1), then I can suggest the levels.");
      return;
    }
    setLevelsBusy(true);
    setLevelsNote("");
    try {
      const response = await fetch(`${backendUrl}/api/trade/suggest-levels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol: orderSymbol.trim(), side: orderSide.toLowerCase(), quantity: validOrder ? quantityValue : null, risk_percent: riskPercent }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Zuri could not suggest levels.");
      if (!body.stops_supported) {
        setLevelsNote("Your broker connection can't attach a stop automatically yet, so set it with your broker.");
        return;
      }
      setStopLoss(String(body.stop_loss));
      setTakeProfit(String(body.take_profit));
      setConfirmed(false);
      const risk = typeof body.risk_amount === "number" ? ` With your quantity, the most you'd lose at the stop is about ${formatMoney(body.risk_amount, body.currency ?? accountCurrency)}.` : "";
      setLevelsNote(`I filled in a stop at ${body.stop_loss} and a target at ${body.take_profit}, based on recent price swings.${risk} Change them if you like. They're your call.`);
    } catch (error) {
      setLevelsNote(error instanceof Error ? error.message : "Zuri could not suggest levels.");
    } finally {
      setLevelsBusy(false);
    }
  }
  const account = linked.data?.account;
  const isLive = linked.data?.environment === "live";
  const accountCurrency = account?.currency ?? "USD";
  const balance = account?.cash ?? 0;
  const equity = account?.equity ?? 0;
  const buyingPower = account?.buying_power ?? 0;
  const quantityValue = Number(quantity);
  const priceValue = Number(limitPrice);
  const estimatedValue = quantityValue * priceValue;
  const validOrder = Number.isFinite(quantityValue) && quantityValue > 0 && Number.isFinite(estimatedValue) && estimatedValue > 0;
  const buyingPowerAfter = Math.max(0, buyingPower - (orderSide === "Buy" && validOrder ? estimatedValue : 0));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!limitPrice && tradeSymbol.hasQuote) setLimitPrice(plainPrice(tradeSymbol.price));
  }, [limitPrice, tradeSymbol.hasQuote, tradeSymbol.price]);
  const formatCurrency = (value: number) => formatMoney(value, accountCurrency);
  const exposurePct = buyingPower > 0 ? ((validOrder ? estimatedValue : 0) / buyingPower * 100).toFixed(1) : "0.0";

  async function submitOrder() {
    if (!linked.data) return;
    setOrderBusy(true);
    setOrderError("");
    setOrderMessage("");
    try {
      const response = await fetch(`${backendUrl}/api/brokers/${linked.data.broker}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol: orderSymbol.trim(), side: orderSide.toLowerCase(), quantity: quantityValue, confirmed, confirmation_phrase: livePhrase, ...(Number(stopLoss) > 0 && Number(takeProfit) > 0 ? { stop_loss: Number(stopLoss), take_profit: Number(takeProfit) } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The order was rejected.");
      const filled = body.status === "filled";
      const closedNote = body.market_open === false && !filled ? ` The ${marketName.toLowerCase()} is closed right now, so your broker is holding this order and will fill it when the market opens${body.next_open ? ` (${formatOpenTime(body.next_open)} your time)` : ""}. It won't show as a position until then. Check History > Orders to see it waiting.` : "";
      const notes = Array.isArray(body.warnings) ? ` ${body.warnings.join(" ")}` : "";
      setOrderMessage(`${isLive ? "LIVE" : "Paper"} order ${filled ? "filled" : "accepted"}: ${body.status ?? "submitted"}.${closedNote}${notes}`);
      if (showCoach) setCoachPlaced(true);
      setOrdersRefresh((value) => value + 1);
      setConfirmed(false);
      setLivePhrase("");
      setStopLoss("");
      setTakeProfit("");
      linked.refresh();
      captureScreenForTrade(token, orderSymbol.trim(), onTraded);
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "The order failed.");
    } finally {
      setOrderBusy(false);
    }
  }

  return (
    <div className="secondary-view trade-view" data-zuri-target="trade-ticket">
      <div className="trade-intro"><div><span className="small-label">ORDER TICKET</span><h2>Place an order</h2><p>{linked.data ? `${linked.data.broker_name} ${isLive ? "live" : "paper"} account · ${accountCurrency}` : "No broker linked"}</p></div>{linked.data && <span className={isLive ? "paper-tag live-tag" : "paper-tag"}>{isLive ? "LIVE · REAL MONEY" : "PAPER MODE"}</span>}</div>
      {!linked.data && <p className="auth-message">{linked.status === "loading" ? "Loading your broker account…" : linked.status === "none" ? "Link a broker in Settings → Broker to place orders." : linked.error}</p>}

      <div className="trade-account-row">
        <div className="trade-account-card">
          <span>Balance</span>
          <strong>{formatCurrency(balance)}</strong>
        </div>
        <div className="trade-account-card">
          <span>Equity</span>
          <strong>{formatCurrency(equity)}</strong>
        </div>
        <div className="trade-account-card">
          <span>Buying power</span>
          <strong>{formatCurrency(buyingPower)}</strong>
        </div>
      </div>

      {showCoach && <FirstTradeCoach step={coachStep} onStep={moveCoach} onExit={() => closeCoach(false)} placed={coachPlaced} onFinish={() => closeCoach(true)} note={levelsNote} onAskLevels={() => void askZuriForLevels()} levelsBusy={levelsBusy} />}
      {!showCoach && linked.data && <button className="text-action coach-reopen" onClick={openCoach}>Guide me through a trade step by step →</button>}

      <div className="trade-layout">
        <section className="content-card order-card">
          <div className={`side-toggle${focusClass(1)}`}><button className={orderSide === "Buy" ? "buy active" : "buy"} onClick={() => setOrderSide("Buy")}>Buy / Long</button><button className={orderSide === "Sell" ? "sell active" : "sell"} onClick={() => setOrderSide("Sell")}>Sell / Short</button></div>
          <label className={`field-label${focusClass(0)}`}>Symbol<input list="order-symbols" value={orderSymbol} maxLength={20} onChange={(event) => { const value = event.target.value.toUpperCase(); setOrderSymbol(value); const nextSymbol = initialInstruments.find((item) => item.symbol === value); if (nextSymbol) { setTradeSymbol(nextSymbol); setLimitPrice(plainPrice(nextSymbol.price)); } }} placeholder={linked.data?.broker === "oanda" ? "EUR_USD" : "AAPL"}/><datalist id="order-symbols">{initialInstruments.map((item) => <option key={item.symbol} value={item.symbol}>{item.name}</option>)}</datalist></label>
          {symbolSwapped && <p className="auth-message" role="status">Alpaca doesn&apos;t trade spot gold, so I switched this to GLD, a fund that tracks the gold price. For spot gold (XAUUSD), link an OANDA account.</p>}
          <div className="field-row"><label className="field-label">Order type<select disabled><option>Market</option></select></label></div>
          <div className={`field-row${focusClass(2)}`}><label className="field-label">Quantity<input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal"/></label><label className="field-label">Reference price ({accountCurrency}, estimate only)<input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal"/></label></div>
          <div className={`field-row${focusClass(3)}`}><label className="field-label">Stop loss (optional)<input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" placeholder="Your price, or ask Zuri"/></label><label className="field-label">Take profit (optional)<input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} inputMode="decimal" placeholder="Your price, or ask Zuri"/></label></div>
          <div className="levels-helper"><button type="button" className="outline-button" disabled={levelsBusy || !linked.data || !orderSymbol.trim()} onClick={() => void askZuriForLevels()}>{levelsBusy ? "Zuri is checking…" : "✦ Ask Zuri to fill the stop loss and take profit"}</button>{levelsNote && <small role="status">{levelsNote}</small>}</div>
          <div className="order-estimate"><span>Estimated value</span><b>{formatCurrency(validOrder ? estimatedValue : 0)}</b><span>Buying power after order</span><b>{formatCurrency(buyingPowerAfter)}</b></div>
          {isLive && <label className="field-label">Type CONFIRM LIVE to place a real-money order<input value={livePhrase} onChange={(event) => setLivePhrase(event.target.value)} autoComplete="off"/></label>}
          {marketClosed && <div className="market-warning" role="alert"><strong>{marketName} is closed{reopens ? ` · reopens ${reopens} (your time)` : ""}</strong><span>{marketQueues ? "Your broker will hold this order and fill it at the next open, possibly at a very different price from now. It won't appear as a position until then." : "Your broker will probably reject this order while the market is closed. Try again when it reopens."}</span></div>}
          <label className={`field-label${focusClass(4)}`}><span><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/> {marketClosed && marketQueues ? `I understand the market is closed and this ${isLive ? "LIVE" : "paper"} order will queue until it opens` : `I confirm this ${isLive ? "LIVE" : "paper"} market order`}</span></label>
          {orderError && <p className="auth-error" role="alert">{orderError}</p>}
          {orderMessage && <p className="auth-message" role="status">{orderMessage}</p>}
          <button className={orderSide === "Buy" ? "submit-order buy-submit" : "submit-order sell-submit"} disabled={!validOrder || !linked.data || !confirmed || orderBusy || (isLive && livePhrase !== "CONFIRM LIVE")} onClick={() => void submitOrder()}>{orderBusy ? "Sending…" : `${orderSide} ${orderSymbol || "—"}`}</button><small className="disclaimer">{isLive ? "This sends a real order to your live broker account." : "Paper order only. No real funds will be used."}</small>
        </section>
        <div className="trade-side">
        <section className="content-card trade-context">
          <div className="section-title"><div><span className="small-label">MARKET SNAPSHOT</span><h2>{tradeSymbol.symbol}</h2></div><span className={tradeSymbol.hasQuote ? (tradeSymbol.up ? "positive" : "negative") : "muted"}>{tradeSymbol.change}</span></div>
          <strong className="snapshot-price">{tradeSymbol.hasQuote && tradeSymbol.group !== "Forex" ? "$" : ""}{tradeSymbol.price}</strong>
          <div className="snapshot-row"><span>Day low</span><b>{tradeSymbol.low ?? "—"}</b><span>Day high</span><b>{tradeSymbol.high ?? "—"}</b></div>
          <div className="snapshot-row"><span>Notional</span><b>{formatCurrency(validOrder ? estimatedValue : 0)}</b><span>Exposure</span><b>{exposurePct}%</b></div>
          <div className="trade-ai-note"><span className="ai-spark">✳</span><div><b>Zuri risk check</b><p>This order would use about {exposurePct}% of your reported buying power (using your reference price). Check your size and exit plan before submitting.</p></div></div>
        </section>
      <TradeConversation token={token} symbol={orderSymbol.trim()} riskPercent={riskPercent} ready={Boolean(linked.data)} onUsePlan={(plan) => {
        setOrderSymbol(plan.symbol);
        const known = initialInstruments.find((item) => item.symbol === plan.symbol);
        if (known) setTradeSymbol(known);
        setOrderSide(plan.side === "buy" ? "Buy" : "Sell");
        setQuantity(String(plan.units));
        setLimitPrice(String(plan.price));
        setStopLoss(plan.stops_supported ? String(plan.stop_loss) : "");
        setTakeProfit(plan.stops_supported ? String(plan.take_profit) : "");
        setConfirmed(false);
      }} />
        </div>
      </div>
      <PendingOrders token={token} enabled={Boolean(linked.data)} refreshKey={ordersRefresh} />
      <section className="content-card positions-card"><div className="section-title"><div><span className="small-label">PORTFOLIO</span><h2>Open positions</h2></div><span className="muted">{linked.data ? `${linked.data.positions.length} positions` : "No broker linked"}</span></div>{linked.data ? <><PositionsTable positions={linked.data.positions} currency={linked.data.account.currency} onClose={(position) => void closePosition(position)} closing={closingSymbol} />{closeMessage && <p className="auth-message" role="status">{closeMessage}</p>}{closeError && <p className="auth-error" role="alert">{closeError}</p>}</> : <p className="muted">Link a broker in Settings → Broker to see your positions.</p>}</section>
    </div>
  );
}
function PositionsTable({ positions, currency, onClose, closing }: { positions: LinkedPosition[]; currency: string | null; onClose?: (position: LinkedPosition) => void; closing?: string }) {
  if (positions.length === 0) return <p className="muted">No open positions.</p>;
  const pct = (value: number | null) => (value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`);
  return <div className="table-scroll"><table><thead><tr><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>ENTRY</th><th>MARK</th><th>UNREALIZED P&L</th><th>RETURN</th>{onClose && <th></th>}</tr></thead><tbody>{positions.map((position) => {
    const isLong = (position.side ?? "long") === "long";
    const pl = position.unrealized_pl;
    return <tr key={position.symbol}><td><b>{position.symbol}</b></td><td><span className={isLong ? "side-pill long" : "side-pill short"}>{isLong ? "Long" : "Short"}</span></td><td>{position.quantity ?? "—"}</td><td>{formatMoney(position.avg_entry_price, currency)}</td><td>{formatMoney(position.current_price, currency)}</td><td className={pl === null ? "" : pl >= 0 ? "positive" : "negative"}>{pl === null ? "—" : `${pl >= 0 ? "+" : "-"}${formatMoney(Math.abs(pl), currency)}`}</td><td className={(position.unrealized_plpc ?? 0) >= 0 ? "positive" : "negative"}>{pct(position.unrealized_plpc)}</td>{onClose && <td><button className="outline-button" disabled={closing === position.symbol} onClick={() => onClose(position)}>{closing === position.symbol ? "Closing…" : "Close"}</button></td>}</tr>;
  })}</tbody></table></div>;
}
function SettingsView({
  token,
  userId,
  email,
  preferences,
  onSavePreferences,
  linked,
  request,
}: {
  token: string;
  linked: LinkedAccountState;
  request: { tab?: string; prefill?: WalkthroughStep["prefill"]; n: number } | null;
  userId: string;
  email: string;
  preferences: UserPreferences | null;
  onSavePreferences: (preferences: UserPreferences) => Promise<void>;
}) {
  const { sendPasswordChangeEmail, deleteAccount, updateDisplayName, updateEmail } = useZuriAuth();
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("Account");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [accountEditing, setAccountEditing] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountEditError, setAccountEditError] = useState("");
  const [accountEditMessage, setAccountEditMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [preferencesDraft, setPreferencesDraft] = useState<UserPreferences | null>(preferences);
  const [preferencesError, setPreferencesError] = useState("");
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [accountDeleteConfirmation, setAccountDeleteConfirmation] = useState("");
  const [accountDeleteBusy, setAccountDeleteBusy] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState("");
  const [panicOpen, setPanicOpen] = useState(false);
  const [panicPhrase, setPanicPhrase] = useState("");
  const [panicBusy, setPanicBusy] = useState(false);
  const [panicError, setPanicError] = useState("");
  const [panicMessage, setPanicMessage] = useState("");

  const closeAll = async () => {
    if (!linked.data) return;
    setPanicBusy(true);
    setPanicError("");
    try {
      const query = linked.data.environment === "live" ? `&confirmation_phrase=${encodeURIComponent(panicPhrase)}` : "";
      const response = await fetch(`${backendUrl}/api/close-all?broker=${linked.data.broker}${query}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({})) as { detail?: unknown; message?: string };
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Closing positions failed.");
      setPanicMessage(body.message ?? "All pending orders were cancelled and open positions closed.");
      setPanicOpen(false);
      setPanicPhrase("");
      linked.refresh();
    } catch (closeError) {
      setPanicError(closeError instanceof Error ? closeError.message : "Closing positions failed.");
    } finally {
      setPanicBusy(false);
    }
  };
  const tabs: SettingsTab[] = ["Account", "Broker", "Trading", "Risk", "Platform", "Display", "Security"];

  useEffect(() => {
    let cancelled = false;
    void loadUserProfile(userId).then((loadedProfile) => {
      if (cancelled) return;
      setProfile(loadedProfile);
      setProfileName(loadedProfile.display_name ?? "");
      setProfileError("");
    }).catch((loadError: unknown) => {
      if (!cancelled) setProfileError(loadError instanceof Error ? loadError.message : "Unable to load your profile.");
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferencesDraft((current) => current ? { ...current, [key]: value } : current);
  };

  // Zuri's guided walkthrough can switch tab and fill in values; the normal autosave then stores them.
  useEffect(() => {
    if (!request) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (request.tab && (tabs as string[]).includes(request.tab)) setSettingsTab(request.tab as SettingsTab);
    const { max_trade_risk_percent: perTrade, max_daily_loss_percent: daily } = request.prefill ?? {};
    if (typeof perTrade === "number") updatePreference("max_trade_risk_percent", perTrade);
    if (typeof daily === "number") updatePreference("max_daily_loss_percent", daily);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  const handleSaveAccountDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextEmail = String(formData.get("email") ?? "").trim();
    const nextName = String(formData.get("displayName") ?? "").trim();
    if (!profile) {
      setAccountEditError("Your profile is still loading. Please try again.");
      return;
    }

    const emailChanged = nextEmail.toLowerCase() !== email.trim().toLowerCase();
    const nameChanged = nextName !== (profile.display_name ?? "");
    if (!emailChanged && !nameChanged) {
      setAccountEditMessage("There are no changes to save.");
      return;
    }

    setAccountSaving(true);
    setAccountEditError("");
    setAccountEditMessage("");
    try {
      if (nameChanged) {
        const updatedProfile = { ...profile, display_name: nextName || null };
        await saveUserProfile(updatedProfile);
        try {
          await updateDisplayName(nextName);
        } catch (metadataError) {
          throw new Error(`Your name was saved to your Zuri profile, but could not be updated for sign-in: ${metadataError instanceof Error ? metadataError.message : "Please try again."}`);
        }
        setProfile(updatedProfile);
        setProfileName(nextName);
      }
      if (emailChanged) {
        try {
          await updateEmail(nextEmail);
        } catch (updateError) {
          throw new Error(`${nameChanged ? "Your name was saved. " : ""}${updateError instanceof Error ? updateError.message : "Unable to update your email. Please try again."}`);
        }
        setAccountEditMessage("Check your inbox to confirm the email change. Your current sign-in email stays active until confirmation.");
      } else {
        setAccountEditMessage("Your account details have been updated.");
      }
      setAccountEditing(false);
    } catch (updateError) {
      setAccountEditError(updateError instanceof Error ? updateError.message : "Unable to update your account details. Please try again.");
    } finally {
      setAccountSaving(false);
    }
  };

  useEffect(() => {
    if (!preferences || !preferencesDraft || JSON.stringify(preferences) === JSON.stringify(preferencesDraft)) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setPreferencesSaving(true);
      setPreferencesError("");
      void onSavePreferences(preferencesDraft).catch((saveError: unknown) => {
        if (!cancelled) {
          setPreferencesError(saveError instanceof Error ? saveError.message : "Unable to save your preferences.");
        }
      }).finally(() => {
        if (!cancelled) setPreferencesSaving(false);
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [onSavePreferences, preferences, preferencesDraft]);

  const tabContent: Record<SettingsTab, React.ReactNode> = {
    Account: (
      <>
        <div className="settings-hero">
          <div>
            <span className="small-label">ZURI PROFILE</span>
            <h3>Your account details</h3>
          </div>
          <span className="status-chip success">signed in</span>
        </div>
        {profileError && <div className="auth-error" role="alert">{profileError}</div>}
        <div className="settings-section">
          <form key={email} onSubmit={handleSaveAccountDetails}>
            <div className="setting-row">
              <div><b>Email</b><small>Your sign-in address</small></div>
              {accountEditing
                ? <input id="account-email" name="email" type="email" defaultValue={email} required autoComplete="email" aria-label="Email address" />
                : <span className="account-detail-static">{email}</span>}
            </div>
            <div className="setting-row">
              <div><b>Name</b><small>Name shown in Zuri</small></div>
              {accountEditing
                ? <input id="profile-name" name="displayName" defaultValue={profileName} maxLength={60} autoComplete="name" aria-label="Display name" />
                : <span className="account-detail-static">{profile?.display_name || "Not set"}</span>}
            </div>
            {accountEditError && <div className="auth-error" role="alert">{accountEditError}</div>}
            {accountEditMessage && <div className="auth-message" role="status">{accountEditMessage}</div>}
            <div className="account-edit-actions">
              {accountEditing ? (
                <>
                  <button className="auth-secondary" type="button" disabled={accountSaving} onClick={() => { setAccountEditing(false); setAccountEditError(""); setAccountEditMessage(""); }}>Cancel</button>
                  <button className="solid-button" type="submit" disabled={accountSaving || !profile}>{accountSaving ? "Saving…" : "Save changes"}</button>
                </>
              ) : (
                <button className="account-edit-button" type="button" disabled={!profile} aria-label="Edit account details" title="Edit account details" onClick={() => { setAccountEditing(true); setAccountEditError(""); setAccountEditMessage(""); }}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.7 2.3a1.4 1.4 0 0 1 2 2L6 12l-3 1 1-3 7.7-7.7Z" /><path d="M9.8 4.2 11.8 6.2" /></svg>
                  <span>Edit details</span>
                </button>
              )}
            </div>
          </form>
          <div className="setting-row"><div><b>Trading journey</b><small>Your experience level</small></div><span className="account-detail-static">{profile?.trading_experience ?? "—"}</span></div>
          {profile?.trading_experience === "Experienced" && <p className="auth-message" role="note">Zuri is built for newer traders first. You can use everything here, and the assistant will keep answers concise and technical. Advanced tools are on the way.</p>}
          {profile?.trading_experience === "Learning the basics" && <p className="auth-message" role="note">The assistant will use standard trading terms with short reminders as you learn.</p>}
        </div>
      </>
    ),
    Broker: (
      <BrokerConnections onChange={linked.refresh} />
    ),
    Trading: (
      <div className="settings-section">
        <span className="small-label">POSITION SETTINGS</span>
        <h3>Trade management</h3>
        <div className="setting-row"><div><b>Max open positions</b><small>Zuri and the order ticket refuse a new position above this number</small></div><input type="number" min={1} max={100} value={preferencesDraft?.max_open_positions ?? 6} onChange={(event) => updatePreference("max_open_positions", Math.min(100, Math.max(1, Math.round(Number(event.target.value) || 1))))} /></div>
        <p className="muted">Every order needs your explicit confirmation, and live orders need the CONFIRM LIVE phrase. That safety can&apos;t be switched off.</p>
      </div>
    ),
    Risk: (
      <div className="settings-section">
        <span className="small-label">RISK CONTROLS</span>
        <h3>Portfolio discipline</h3>
        <div className="setting-row" data-zuri-target="risk-max-daily"><div><b>Max daily loss (%)</b><small>Zuri warns you when today&apos;s losses reach this</small></div><input type="number" min={0} max={100} step="0.01" value={preferencesDraft?.max_daily_loss_percent ?? 2} onChange={(event) => updatePreference("max_daily_loss_percent", Number(event.target.value))} /></div>
        <div className="setting-row" data-zuri-target="risk-max-trade"><div><b>Max trade risk (%)</b><small>Orders that risk more than this are refused</small></div><input type="number" min={0} max={100} step="0.01" value={preferencesDraft?.max_trade_risk_percent ?? 0.75} onChange={(event) => updatePreference("max_trade_risk_percent", Number(event.target.value))} /></div>
        <div className="setting-row"><div><b>Emergency close all</b><small>{linked.data ? "Cancels pending orders and closes every open position" : "Link a broker to use this"}</small></div>
          {!panicOpen ? <button className="danger-button" type="button" disabled={!linked.data} onClick={() => { setPanicOpen(true); setPanicError(""); setPanicMessage(""); }}>Close all</button> : (
            <div className="panic-confirm">
              {linked.data?.environment === "live" && <input value={panicPhrase} onChange={(event) => setPanicPhrase(event.target.value)} placeholder="Type CONFIRM LIVE" autoComplete="off" aria-label="Type CONFIRM LIVE" />}
              <button className="danger-button" type="button" disabled={panicBusy || (linked.data?.environment === "live" && panicPhrase !== "CONFIRM LIVE")} onClick={() => void closeAll()}>{panicBusy ? "Closing…" : "Yes, close everything"}</button>
              <button className="text-action" type="button" disabled={panicBusy} onClick={() => { setPanicOpen(false); setPanicPhrase(""); }}>Cancel</button>
            </div>
          )}
        </div>
        {panicError && <p className="auth-error" role="alert">{panicError}</p>}
        {panicMessage && <p className="auth-message" role="status">{panicMessage}</p>}
      </div>
    ),
    Platform: (
      <>
        <div className="settings-section">
          <span className="small-label">PLATFORM</span>
          <h3>Terminal behavior</h3>
          <div className="setting-row"><div><b>Remember my chart</b><small>Reopen on the symbol and timeframe you last used</small></div><input type="checkbox" checked={preferencesDraft?.save_chart_layout_enabled ?? true} onChange={(event) => updatePreference("save_chart_layout_enabled", event.target.checked)} /></div>
        </div>
        <div className="settings-section">
          <span className="small-label">CHARTS</span>
          <h3>Workspace defaults</h3>
          <div className="setting-row"><div><b>Default chart timeframe</b><small>Used when nothing is remembered</small></div><select value={preferencesDraft?.default_timeframe ?? "15m"} onChange={(event) => updatePreference("default_timeframe", event.target.value)}><option>1m</option><option>5m</option><option>15m</option><option>1h</option><option>4h</option><option>1D</option><option>1W</option></select></div>
          <div className="setting-row"><div><b>Default symbol</b><small>Used when nothing is remembered</small></div><select value={preferencesDraft?.default_symbol ?? "BTCUSD"} onChange={(event) => updatePreference("default_symbol", event.target.value)}>{initialInstruments.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.symbol}</option>)}</select></div>
        </div>
      </>
    ),
    Display: (
      <div className="settings-section">
        <span className="small-label">DISPLAY</span>
        <h3>Time</h3>
        <div className="setting-row"><div><b>Time zone</b><small>The desk clock and every timestamp in Zuri</small></div><select value={preferencesDraft?.time_zone ?? "UTC"} onChange={(event) => updatePreference("time_zone", event.target.value)}>{TIME_ZONE_NAMES.map((name) => <option key={name}>{name}</option>)}</select></div>
      </div>
    ),
    Security: (
      <>
        <div className="settings-section">
          <span className="small-label">SECURITY</span>
          <h3>Access and protection</h3>
          <div className="password-change">
            <div><b>Change password</b><small>For your security, we email a link to <b>{email}</b>. Open it to choose a new password.</small></div>
            {passwordError && <div className="auth-error" role="alert">{passwordError}</div>}
            {passwordMessage && <div className="auth-message" role="status">{passwordMessage}</div>}
            <button className="solid-button" type="button" disabled={passwordBusy} onClick={async () => {
              setPasswordError("");
              setPasswordMessage("");
              setPasswordBusy(true);
              try {
                const sentTo = await sendPasswordChangeEmail();
                setPasswordMessage(`We sent a password change link to ${sentTo}. Open it from your email to choose a new password.`);
              } catch (sendError) {
                setPasswordError(sendError instanceof Error ? sendError.message : "Unable to send the email. Please try again in a minute.");
              } finally {
                setPasswordBusy(false);
              }
            }}>{passwordBusy ? "Sending…" : "Email me a change link"}</button>
          </div>
          <div className="setting-row"><div><b>Two-factor auth</b><small>Configure available sign-in methods in Supabase</small></div><input type="checkbox" disabled aria-label="Two-factor authentication is not available in this prototype" /></div>
          <div className="setting-row"><div><b>Session timeout</b><small>Session timeout controls are not available yet</small></div><select value="30 min" disabled aria-label="Session timeout is not available in this prototype"><option>10 min</option><option>30 min</option><option>1 hour</option><option>4 hours</option></select></div>
          <div className="setting-row"><div><b>Hide account values</b><small>Mask sensitive numbers</small></div><input type="checkbox" checked={preferencesDraft?.hide_account_values ?? false} onChange={(event) => updatePreference("hide_account_values", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Export permissions</b><small>Allow CSV and PDF reports</small></div><input type="checkbox" checked={preferencesDraft?.allow_data_exports ?? true} onChange={(event) => updatePreference("allow_data_exports", event.target.checked)} /></div>
        </div>
        <div className="settings-section account-danger-zone">
          <span className="small-label">DANGER ZONE</span>
          <h3>Delete your Zuri account</h3>
          <p>This permanently deletes your Zuri sign-in account, profile, saved preferences, journal entries, and watchlist. You will be signed out and shown the introduction again.</p>
          {!accountDeleteOpen ? (
            <button className="danger-button" type="button" onClick={() => { setAccountDeleteOpen(true); setAccountDeleteError(""); }}>Delete account</button>
          ) : (
            <div className="account-delete-confirm">
              <label htmlFor="account-delete-confirmation">Type DELETE to confirm</label>
              <input id="account-delete-confirmation" value={accountDeleteConfirmation} onChange={(event) => setAccountDeleteConfirmation(event.target.value)} autoComplete="off" />
              {accountDeleteError && <div className="auth-error" role="alert">{accountDeleteError}</div>}
              <div className="account-delete-actions">
                <button className="auth-secondary" type="button" disabled={accountDeleteBusy} onClick={() => { setAccountDeleteOpen(false); setAccountDeleteConfirmation(""); setAccountDeleteError(""); }}>Cancel</button>
                <button className="danger-button" type="button" disabled={accountDeleteBusy || accountDeleteConfirmation !== "DELETE"} onClick={async () => {
                  setAccountDeleteBusy(true);
                  setAccountDeleteError("");
                  try {
                    await deleteAccount();
                  } catch (deleteError) {
                    setAccountDeleteError(deleteError instanceof Error ? deleteError.message : "Unable to delete your account. Please try again.");
                    setAccountDeleteBusy(false);
                  }
                }}>{accountDeleteBusy ? "Deleting…" : "Permanently delete account"}</button>
              </div>
            </div>
          )}
        </div>
      </>
    ),
  };

  return (
    <div className="secondary-view settings-view">
      {preferencesError && <div className="auth-error" role="alert">{preferencesError}</div>}
      {!preferencesDraft && <div className="auth-message" role="status">Loading your saved preferences…</div>}
      {preferencesSaving && <div className="auth-message" role="status">Saving your preferences…</div>}

      <div className="settings-footer">
        <div className="settings-footer-card">
          <span className="small-label">BROKER STATUS</span>
          <strong>{linked.data ? `${linked.data.broker_name} connected` : linked.status === "loading" ? "Checking…" : "Not linked"}</strong>
        </div>
        <div className="settings-footer-card">
          <span className="small-label">ENVIRONMENT</span>
          <strong>{linked.data ? (linked.data.environment === "live" ? "Live (real money)" : "Paper / practice") : "—"}</strong>
        </div>
        <div className="settings-footer-card">
          <span className="small-label">ACCOUNT</span>
          <strong>{email}</strong>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" data-zuri-target="settings-tabs" aria-label="Settings sections">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={settingsTab === tab ? "active" : ""}
              onClick={() => setSettingsTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="content-card settings-card" data-zuri-target="settings-panel">
          {tabContent[settingsTab]}
        </div>
      </div>
    </div>
  );
}

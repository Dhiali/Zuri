"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useZuriAuth, ZuriAuthGate } from "./auth";
import { BrokerConnections } from "./broker-connections";
import { HistoryView } from "./history-view";
import { CommunityPanel, CoachingPanel } from "./dashboard-insights";
import { TradeConversation } from "./trade-conversation";
import { SnapshotGallery, captureScreenForTrade } from "./trade-snapshots";
import { ChartResearch } from "./chart-research";
import { backendUrl, formatMoney, useLinkedAccount, type LinkedAccountState, type LinkedPosition } from "./linked-account";
import {
  addJournalEntry,
  deleteJournalEntry,
  initialWatchlistSymbols,
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
import { JourneyChecklist, ZuriMascot, ZuriWelcome } from "./zuri-journey";
import { ZuriGuide } from "./zuri-guide";
import { draftJournalNote, JournalInsights, trackJourneyEvent } from "./journal-insights";

type Section = "Charts" | "Dashboard" | "Trade" | "History" | "Journal" | "Settings";
type SettingsTab = "Account" | "Broker" | "Trading" | "Risk" | "Platform" | "Display" | "Notifications" | "Security";
type Instrument = { symbol: string; name: string; price: string; change: string; up: boolean; icon: string; group: string; tickDirection?: "up" | "down"; tickSequence?: number };
type MarketNewsArticle = { id: string; title: string; summary: string; source: string; published_at: string | null; url: string; related_symbols: string[]; market_wide: boolean; category: "trading" | "world" };
type MarketNewsResponse = { articles: MarketNewsArticle[]; fetched_at: string; refresh_after_seconds: number; sources: string[]; warnings: string[] };
type BacktestNewsContext = { title: string; published_at: string | null };

const initialInstruments: Instrument[] = [
  { symbol: "BTCUSD", name: "Bitcoin / U.S. Dollar", price: "85,890", change: "+1.22%", up: true, icon: "₿", group: "Crypto" },
  { symbol: "ETHUSD", name: "Ethereum / U.S. Dollar", price: "2,284.60", change: "+0.84%", up: true, icon: "◆", group: "Crypto" },
  { symbol: "SOLUSD", name: "Solana / U.S. Dollar", price: "142.82", change: "−0.36%", up: false, icon: "◎", group: "Crypto" },
  { symbol: "EURUSD", name: "Euro / U.S. Dollar", price: "1.12643", change: "+0.20%", up: true, icon: "€", group: "Forex" },
  { symbol: "GOLD", name: "Gold Spot / U.S. Dollar", price: "4,184.70", change: "+0.24%", up: true, icon: "Au", group: "Commodities" },
  { symbol: "AAPL", name: "Apple Inc.", price: "257.13", change: "−0.18%", up: false, icon: "A", group: "Stocks" },
];

const simulatedTickSizes: Record<string, number> = { BTCUSD: 18, ETHUSD: 1.4, SOLUSD: 0.18, EURUSD: 0.00015, GOLD: 0.45, AAPL: 0.16 };

function advanceInstrument(instrument: Instrument): Instrument {
  const price = Number(instrument.price.replace(/,/g, ""));
  const delta = (Math.random() * 2 - 1) * simulatedTickSizes[instrument.symbol];
  const nextPrice = Math.max(0.00001, price + delta);
  const previousChange = Number(instrument.change.replace("−", "-").replace("%", ""));
  const nextChange = previousChange + (delta / price) * 100;
  const precision = instrument.symbol === "BTCUSD" ? 0 : instrument.group === "Forex" ? 5 : 2;
  return {
    ...instrument,
    price: nextPrice.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision }),
    change: `${nextChange >= 0 ? "+" : "−"}${Math.abs(nextChange).toFixed(2)}%`,
    up: nextChange >= 0,
    tickDirection: delta >= 0 ? "up" : "down",
    tickSequence: (instrument.tickSequence ?? 0) + 1,
  };
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
  const [watchlistSymbols, setWatchlistSymbols] = useState(initialWatchlistSymbols);
  const watchlistSnapshot = JSON.stringify(watchlistSymbols);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [workspaceDataUserId, setWorkspaceDataUserId] = useState<string | null>(null);
  const watchlistInstruments = instruments.filter((instrument) => watchlistSymbols.includes(instrument.symbol));
  const [selectedSymbol, setSelectedSymbol] = useState(initialInstruments[0].symbol);
  const [timeframe, setTimeframe] = useState("15m");
  const [activeTool, setActiveTool] = useState("");
  const [orderSide, setOrderSide] = useState<"Buy" | "Sell">("Buy");
  const [query, setQuery] = useState("");
  const [aiExpanded, setAiExpanded] = useState(false);
  const [aiOnChart, setAiOnChart] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(true);
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
  const symbol = instruments.find((instrument) => instrument.symbol === activeSymbol) ?? initialInstruments.find((instrument) => instrument.symbol === activeSymbol) ?? initialInstruments[0];
  const aiBias = symbol.up ? "UPWARD BIAS" : "DOWNWARD BIAS";

  useEffect(() => {
    if (section === "Charts" && workspaceDataUserId === userId) trackJourneyEvent(accessToken, "symbol_viewed", activeSymbol);
  }, [section, activeSymbol, accessToken, userId, workspaceDataUserId]);
  const aiBrief = `The simulated ${symbol.symbol} quote is ${symbol.change} today. Treat this as a watch cue, then verify price action and risk before placing a paper order.`;
  const searchUniverse = query.trim() ? instruments : watchlistInstruments;
  const filteredInstruments = searchUniverse.filter((item) => `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const updateDeskDate = () => {
      const now = new Date();
      setDeskDate(new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
      }).format(now).toUpperCase());
      setDeskTime(new Intl.DateTimeFormat("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }).format(now));
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
      setSelectedSymbol(symbols.includes(preferences.default_symbol)
        ? preferences.default_symbol
        : symbols[0] ?? initialInstruments[0].symbol);
      setTimeframe(preferences.default_timeframe);
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
    const ticker = window.setInterval(() => {
      setInstruments((current) => current.map(advanceInstrument));
    }, 1800);
    return () => window.clearInterval(ticker);
  }, []);

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

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <a className="brand" href="#charts" onClick={() => setSection("Charts")} aria-label="Zuri home"><Image className="brand-logo" src="/zuri-logo.jpg" alt="" width={768} height={768} priority /><span>zuri<span className="brand-dot">.</span></span></a>
        <div className="top-divider" />
        <div className="market-strip"><span className="live-dot" /> NYSE <span className="strip-separator">/</span> NASDAQ <span className="market-open">{linkedAccount.data ? `${linkedAccount.data.broker_name.toUpperCase()} · ${linkedAccount.data.environment === "live" ? "LIVE" : "PAPER"}` : "NO BROKER LINKED"}</span></div>
        <div className="topbar-right"><button className={`icon-action zuri-top${journey?.phase === "intro" ? " is-away" : ""}`} title="Ask Zuri" aria-label="Ask Zuri" onClick={() => setAssistantOpen(true)}><ZuriMascot size={34} /></button><button className="icon-action notification" title="Notifications">♧<i /></button><span className="topbar-email">{session?.user.email}</span><button className="signout-button" onClick={async () => { try { await signOut(); } catch (signOutError) { setAccountError(signOutError instanceof Error ? signOutError.message : "Unable to sign out."); } }}>Sign out</button>{accountError && <span className="topbar-auth-error" role="alert">{accountError}</span>}</div>
      </header>
      <div className={section === "Settings" ? "workspace settings-workspace" : "workspace"}>
        <nav className="primary-nav" aria-label="Primary navigation">
          <div className="nav-main">{(["Charts", "Dashboard", "Trade", "History", "Journal"] as Section[]).map((item) => <button key={item} onClick={() => setSection(item)} className={section === item ? "nav-item selected" : "nav-item"} title={item}><Icon name={item}/><span>{item}</span></button>)}</div>
          <div className="nav-bottom"><button onClick={() => setSection("Settings")} className={section === "Settings" ? "nav-item selected" : "nav-item"} title="Settings"><Icon name="Settings"/><span>Settings</span></button><div className="nav-help">?</div></div>
        </nav>
        <div className="content-column">
          <div className="page-heading"><div><div className="eyebrow">PERSONAL TRADING DESK <span>•</span> {deskDate} <span>•</span> <time>{deskTime}</time></div><h1>{section === "Charts" ? "Charts" : section}</h1></div></div>
          {dataError && <div className="auth-error" role="alert">{dataError}</div>}
          {workspaceDataUserId !== session?.user.id ? (
            <div className="content-card"><p>{dataError ? "Your saved workspace data could not be loaded. Please try again after checking the database setup." : "Loading your saved workspace…"}</p></div>
          ) : <>
          {section === "Charts" && <>
            <div className="journal-chart-bar">
              <div className="journal-chart-symbol"><span className={`watch-icon ${symbol.group.toLowerCase()}`}>{symbol.icon}</span><span><b>{symbol.symbol}</b><small>{symbol.name}</small></span></div>
              <div className="journal-intervals" aria-label="Chart interval">{timeframes.map((item) => <button key={item} className={timeframe === item ? "time-button active" : "time-button"} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
              <div className="journal-chart-actions">
                <button className="journal-capture-button" onClick={() => { setJournalDraftSide("Watching"); setJournalDraftOpen(true); }}>＋ <span>Note</span></button>
                <button className="journal-plan-button long" onClick={() => { setJournalDraftSide("Long"); setJournalDraftOpen(true); }}>↗ <span>Long plan</span></button>
                <button className="journal-plan-button short" onClick={() => { setJournalDraftSide("Short"); setJournalDraftOpen(true); }}>↘ <span>Short plan</span></button>
                <button className="journal-saved-button" onClick={() => setSection("Journal")}>Journal <span>{journalEntries.length}</span></button>
              </div>
            </div>
            <div className="chart-toolbar"><button className="symbol-select" onClick={() => setWatchlistOpen(!watchlistOpen)}><span className="coin btc">{symbol.icon}</span><b>{symbol.symbol}</b><span className="chevron">⌄</span></button><div className="toolbar-divider"/>{timeframes.map((item) => <button key={item} className={timeframe === item ? "time-button active" : "time-button"} onClick={() => setTimeframe(item)}>{item}</button>)}<div className="toolbar-divider"/><button className="indicator-button">⌁ <span>Indicators</span></button><button className="chart-icon-button" title="Chart layout">▦</button><button className="chart-icon-button" title="Take snapshot">⌗</button><span className="toolbar-spacer"/><span className="chart-live"><i/>DEMO</span></div>
            <div className="market-summary"><div><span className="instrument-name">{symbol.name} <span className="exchange-tag">· {symbol.group === "Crypto" ? "COINBASE" : "GLOBAL"}</span></span><strong>{symbol.price}</strong><span className={symbol.up ? "positive" : "negative"}>{symbol.change} <small>today</small></span></div><div className="ohlc"><span>O <b>85,742</b></span><span>H <b>86,104</b></span><span>L <b>85,518</b></span><span>C <b>85,890</b></span><span>Vol <b>1.24B</b></span></div></div>
            <section className="chart-panel"><div className="chart-labels"><span><i className="legend-candle"/> Candles</span><span><i className="legend-line"/> EMA 20</span><span className="chart-label-right">USD <span>⌄</span></span></div><div className="chart-stage"><aside className="drawing-toolbar">{chartTools.slice(0, 9).map((tool, index) => <button key={`${tool}-draw-${index}`} className={activeTool === tool ? "drawing-button chosen" : "drawing-button"} title={`Drawing tool ${index + 1}`} onClick={() => setActiveTool(activeTool === tool ? "" : tool)}>{tool}</button>)}<span className="draw-separator"/><button className="drawing-button" title="Remove drawings" onClick={() => setActiveTool("")}>⌫</button></aside><Chart symbol={symbol} timeframe={timeframe} drawing={activeTool} aiOnChart={aiOnChart}/></div><div className="chart-footer"><span>⌖ Crosshair</span><span>⤢ Auto</span><span className="chart-footer-spacer"/><span>1D</span><span>5D</span><span>1M</span><span>6M</span><span>1Y</span><span>ALL</span><span className="utc">17:24:08 UTC</span></div></section>
            <div className="lower-tabs"><button className="lower-tab active">Overview</button><button className="lower-tab">Ideas <span className="count">3</span></button><button className="lower-tab">Financials</button><button className="lower-tab">News <span className="count">5</span></button><span className="lower-tabs-right">Data delayed by up to 15 min</span></div>
            <div className="below-chart"><section className="watch-summary"><div className="section-title"><div><span className="small-label">YOUR WATCHLIST</span><h2>Market pulse</h2></div><button className="text-action" onClick={() => setWatchlistOpen(!watchlistOpen)}>View watchlist ↗</button></div><div className="pulse-row"><span>Fear & Greed</span><strong>68 <small>Greed</small></strong><div className="sentiment-track"><i/></div><span className="positive">+6 pts</span></div><div className="pulse-row"><span>BTC dominance</span><strong>58.4%</strong><span className="muted">+0.3% this week</span></div></section><section className="ai-takeaway"><div className="ai-heading"><span className="ai-spark">✳</span><span className="small-label">ZURI AI · DEMO CHART READ</span><span className="confidence">QUOTE CONTEXT</span></div><h2>{symbol.symbol} · {symbol.up ? "Upward" : "Downward"} bias</h2><p>{aiBrief}</p><div className="ai-foot"><span>Based on simulated quote data</span><button className="text-action" onClick={() => setAiExpanded(!aiExpanded)}>{aiExpanded ? "Hide analysis ↑" : "See full analysis →"}</button></div>{aiExpanded && <div className="ai-expanded">This prototype insight reflects the demo quote direction only. It is not live market analysis or a recommendation.</div>}</section></div>
            {journalDraftOpen && <JournalCapture symbol={symbol} timeframe={timeframe} initialSide={journalDraftSide} onSave={saveJournalEntry} onCancel={() => setJournalDraftOpen(false)} />}
          </>}
          {section === "Dashboard" && (
            <Dashboard
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
              checklist={journey?.phase === "done" ? (
                <JourneyChecklist
                  journey={journey}
                  brokerLinked={linkedAccount.status === "ready"}
                  hasPositions={(linkedAccount.data?.positions.length ?? 0) > 0}
                  journalCount={journalEntries.length}
                  onChange={updateJourney}
                  setSection={setSection}
                />
              ) : null}
            />
          )}
          {section === "Trade" && <TradeView symbol={symbol} orderSide={orderSide} setOrderSide={setOrderSide} linked={linkedAccount} token={session?.access_token ?? ""} onTraded={reloadJournal} riskPercent={userPreferences?.max_trade_risk_percent ?? 1}/>}
          {section === "History" && <HistoryView linked={linkedAccount} token={accessToken} refreshKey={journalRefresh} />}
          {section === "Journal" && <JournalView entries={journalEntries} token={accessToken} refreshKey={journalRefresh} onReload={reloadJournal} onNewEntry={() => { setSection("Charts"); setJournalDraftSide("Watching"); setJournalDraftOpen(true); }} onDelete={(id) => void removeJournalEntry(id)} />}
          {section === "Settings" && session && <SettingsView linked={linkedAccount} userId={session.user.id} email={session.user.email ?? ""} preferences={userPreferences} onSavePreferences={async (preferences) => {
            await saveUserPreferences(preferences);
            setUserPreferences(preferences);
            setTimeframe(preferences.default_timeframe);
            if (watchlistSymbols.includes(preferences.default_symbol)) setSelectedSymbol(preferences.default_symbol);
          }} />}
          {session && workspaceDataUserId === session.user.id && <ChartResearch
            symbol={symbol.symbol}
            timeframe={timeframe}
            broker={linkedAccount.data?.broker ?? ""}
            token={accessToken}
            userId={session.user.id}
            eventContext={backtestNewsContext}
            onClearEventContext={() => setBacktestNewsContext(null)}
            visible={section === "Charts"}
          />}
          </>}
        </div>
        {section !== "Settings" && <aside className={watchlistOpen ? "right-rail" : "right-rail collapsed"}>
          <div className="rail-head"><div><h2>Quotes</h2><span className="rail-count"><i className="quote-live-dot"/> {watchlistInstruments.length} symbols · SIMULATED</span></div><button className="rail-action" title="Add symbol" onClick={() => document.getElementById("market-search")?.focus()}>＋</button><button className="rail-action" title="Collapse quotes" onClick={() => setWatchlistOpen(false)}>⌄</button></div>
          {watchlistOpen && <>
            <label className="search-box"><span>⌕</span><input id="market-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quotes"/><kbd>/</kbd></label>
            <div className="watchlist-columns"><span>SYMBOL</span><span>BID</span><span>ASK</span></div>
            <div className="watchlist-items">
              {filteredInstruments.map((item) => {
                const isInWatchlist = watchlistSymbols.includes(item.symbol);
                const midPrice = Number(item.price.replace(/,/g, ""));
                const quoteSpread = midPrice * (item.group === "Forex" ? 0.0001 : 0.00007);
                const quotePrecision = item.group === "Forex" ? 5 : 2;
                const formatQuote = (price: number) => price.toLocaleString("en-US", { minimumFractionDigits: quotePrecision, maximumFractionDigits: quotePrecision });
                return <div key={item.symbol} className={isInWatchlist && symbol.symbol === item.symbol ? "watch-row selected" : "watch-row"}>
                <button className="watch-row-main" onClick={() => isInWatchlist ? (setSelectedSymbol(item.symbol), setSection("Charts")) : addInstrument(item.symbol)} aria-label={isInWatchlist ? `Select ${item.symbol}` : `Preview ${item.symbol} quote and add to watchlist`}>
                  <span className={`watch-icon ${item.group.toLowerCase()}`}>{item.icon}</span><span className="watch-symbol"><b>{item.symbol}</b><small>{item.group}</small></span><span key={`${item.tickSequence}-bid`} className={`quote-price tick-${item.tickDirection ?? "up"}`}>{formatQuote(Math.max(0.00001, midPrice - quoteSpread / 2))}</span><span key={`${item.tickSequence}-ask`} className={`quote-price tick-${item.tickDirection ?? "up"}`}>{formatQuote(midPrice + quoteSpread / 2)}</span>
                </button>
                <button className="watch-remove" title={isInWatchlist ? `Remove ${item.symbol} from watchlist` : `Add ${item.symbol} to watchlist`} aria-label={isInWatchlist ? `Remove ${item.symbol} from watchlist` : `Add ${item.symbol} to watchlist`} onClick={() => isInWatchlist ? removeInstrument(item.symbol) : addInstrument(item.symbol)}>{isInWatchlist ? "×" : "+"}</button>
              </div>;
              })}
              {filteredInstruments.length === 0 && <div className="empty-search">{watchlistSymbols.length === 0 && !query ? "Your watchlist is empty. Search to add symbols." : "No matching markets"}</div>}
            </div>
            <div className="rail-section-heading"><span>ZURI AI OVERVIEW</span><span className="live-dot"/></div>
            <section className="ai-overview-card">
              <div className="ai-overview-header">
                <div className="ai-badge"><span className="ai-badge-mark">✦</span><span>ZURI AI</span></div>
                <span className="ai-overview-status">LIVE</span>
              </div>
              <h3>{symbol.symbol} is in a {symbol.up ? "bullish continuation" : "defensive rotation"} regime.</h3>
              <p>
                {symbol.up
                  ? "Momentum is holding above the local structure and the tape remains constructive. Keep risk tight and let the trend confirm on pullbacks."
                  : "The tape is softening under pressure and the broader rotation is favoring caution. Respect levels, size down, and wait for confirmation before adding exposure."}
              </p>
              <div className="ai-overview-grid">
                <div className="ai-metric">
                  <span>Bias</span>
                  <strong className={symbol.up ? "positive" : "negative"}>{symbol.up ? "Bullish" : "Bearish"}</strong>
                </div>
                <div className="ai-metric">
                  <span>Risk</span>
                  <strong>1.2%</strong>
                </div>
                <div className="ai-metric">
                  <span>Trend</span>
                  <strong>{symbol.up ? "Up" : "Down"}</strong>
                </div>
                <div className="ai-metric">
                  <span>Setup</span>
                  <strong>Breakout</strong>
                </div>
              </div>
              <div className="ai-overview-foot">
                <span>Signal score</span>
                <strong>{symbol.up ? "82/100" : "67/100"}</strong>
              </div>
              <div className="ai-overview-actions">
                <button className="news-link" aria-pressed={aiOnChart} onClick={() => setAiOnChart(!aiOnChart)}>{aiOnChart ? "Hide chart context" : "Add to chart"}</button>
                <button className="text-action">Deep dive →</button>
              </div>
            </section>
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
        </aside>}
      </div>
      <footer className="statusbar"><span><i className="live-dot"/> All systems operational</span><span>{linkedAccount.data ? (linkedAccount.data.environment === "live" ? "Live trading" : "Paper trading") : "Trading"} <b>{linkedAccount.data ? "ON" : "OFF"}</b></span><span>Prices in USD</span><span className="status-spacer"/><span>⌁ &nbsp;Help center</span></footer>
      {journey?.phase === "intro" && (
        <ZuriWelcome experience={session?.user.user_metadata?.trading_experience as string | undefined} accessToken={session?.access_token ?? ""} section={section} onFinish={() => updateJourney({ ...journey, phase: "done", mode: journey.mode ?? "assistant" })} onSkip={() => updateJourney({ ...journey, phase: "done", mode: journey.mode ?? "assistant", completed_steps: [...new Set([...journey.completed_steps, "guide:skipped"])] })} />
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
      />
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
    setIsSending(true);

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${backendUrl}/api/assistant/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: conversation,
          context: {
            section,
            symbol: symbol.symbol,
            timeframe,
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
      const result = await response.json() as { reply?: unknown; detail?: unknown };
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reach Zuri AI.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="aura-assistant">
      {isOpen && (
        <section className="aura-panel" aria-label="Zuri AI trading companion">
          <header className="aura-panel-header">
            <span className="aura-orb aura-orb-small" aria-hidden="true"><span>✦</span></span>
            <div className="aura-panel-title">
              <strong>Zuri <span>AI</span></strong>
              <small>Your trading companion</small>
            </div>
            <button className="aura-close" type="button" aria-label="Close Zuri AI" onClick={() => onOpenChange(false)}>×</button>
          </header>
          <div className="aura-context">
            <span className="aura-context-dot" />
            With you in <b>{section}</b><span>·</span><b>{symbol.symbol}</b><span>·</span>{timeframe}
          </div>
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
            {error && <p className="aura-error" role="alert">{error}</p>}
          </div>
          {messages.length === 1 && (
            <div className="aura-suggestions">
              <button type="button" onClick={() => void sendMessage("What should I consider when setting a stop loss?")}>Stop-loss basics</button>
              <button type="button" onClick={() => void sendMessage(`Help me create a risk checklist for ${symbol.symbol}.`)}>Review my checklist</button>
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
          <p className="aura-disclaimer">Educational support only · no trades are submitted</p>
        </section>
      )}
      <button
        className={`aura-launcher${isOpen ? " open" : ""}`}
        type="button"
        aria-label={isOpen ? "Close Zuri AI assistant" : "Open Zuri AI assistant"}
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="aura-orb" aria-hidden="true"><span>✦</span></span>
        <span className="aura-launcher-label">{isOpen ? "Close" : "Ask Zuri"}</span>
      </button>
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
      <div className="section-title journal-view-heading"><div><span className="small-label">AUTOMATIC JOURNEY TRACKING · SAVED TO YOUR ACCOUNT</span><h2>Trading journal</h2></div><button className="solid-button" onClick={onNewEntry}>＋ <span>New entry</span></button></div>
      <JournalInsights token={token} refreshKey={refreshKey} onEntriesChanged={onReload} />
      {draftError && <p className="auth-message" role="alert">{draftError}</p>}
      {entries.length === 0 ? <div className="content-card journal-empty"><span className="small-label">NO ENTRIES YET</span><h3>Start with a chart idea</h3><p>Capture a setup, define your risk, and write down what would invalidate the trade.</p><button className="outline-button" onClick={onNewEntry}>Open chart and write a note</button></div> : <div className="journal-entry-list">{entries.map((entry) => <article className="content-card journal-entry" key={entry.id}>
        <div className="journal-entry-heading"><div><span className="small-label">{entry.setup} · {entry.timeframe}</span><h3>{entry.symbol} <span className={`side-pill ${entry.side === "Short" ? "short" : entry.side === "Long" ? "long" : "watching"}`}>{entry.side}</span></h3></div><div className="journal-entry-actions"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time><button className="text-action" onClick={() => onDelete(entry.id)} aria-label={`Delete ${entry.symbol} journal entry`}>Delete</button></div></div>
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
    <section className={`market-news-panel ${variant}`} aria-labelledby={`market-news-title-${variant}`}>
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
                  ? new Date(article.published_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
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
        {news && <span>Updated {new Date(news.fetched_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · refreshes every 5 min</span>}
      </div>
      <p className="market-news-disclaimer">Headlines are not forecasts. Zuri’s explanation is an AI interpretation, not a prediction or financial advice.</p>
    </section>
  );
}

function Dashboard({
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
}: {
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
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [greetingDate] = useState(() => new Date());
  const hour = greetingDate.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="secondary-view">
      <div className="dashboard-greeting">
        <div><span className="small-label">{greetingDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).toUpperCase()}</span><h2>{greeting}.</h2><p>Here’s the signal behind your numbers today.</p></div>
        <button className="solid-button" onClick={() => setSection("Trade")}>＋ <span>New order</span></button>
      </div>
      {checklist}
      <CoachingPanel token={token} refreshKey={refreshKey} onTags={setSuggestedTags} />
      <CommunityPanel token={token} suggestedTags={suggestedTags} />
      <MarketNewsSection variant="dashboard" news={news} loading={loading} error={error} onRefresh={onRefresh} onAskAboutStory={onAskAboutStory} />
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
    </div>
  );
}
function Metric({ label, value, change }: { label: string; value: string; change: string }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small className={change.startsWith("+") ? "positive" : "muted"}>{change}</small></div>; }
function TradeView({ symbol, orderSide, setOrderSide, linked, token, onTraded, riskPercent }: { symbol: Instrument; orderSide: "Buy" | "Sell"; setOrderSide: (side: "Buy" | "Sell") => void; linked: LinkedAccountState; token: string; onTraded: () => void; riskPercent: number }) {
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [tradeSymbol, setTradeSymbol] = useState(symbol);
  const [orderSymbol, setOrderSymbol] = useState(symbol.symbol);
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState(symbol.price.replace(/,/g, ""));
  const [confirmed, setConfirmed] = useState(false);
  const [livePhrase, setLivePhrase] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [orderError, setOrderError] = useState("");
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
  const quotePrecision = tradeSymbol.group === "Forex" ? 5 : 2;
  const quotePrice = Number(tradeSymbol.price.replace(/,/g, ""));
  const spread = quotePrice * (tradeSymbol.group === "Forex" ? 0.0001 : 0.00007);
  const formatCurrency = (value: number) => formatMoney(value, accountCurrency);
  const formatQuote = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: quotePrecision, maximumFractionDigits: quotePrecision });
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
      setOrderMessage(`${isLive ? "LIVE" : "Paper"} order sent: ${body.status ?? "submitted"}.`);
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
    <div className="secondary-view trade-view">
      <div className="trade-intro"><div><span className="small-label">ORDER TICKET</span><h2>Place an order</h2><p>{linked.data ? `${linked.data.broker_name} ${isLive ? "live" : "paper"} account · ${accountCurrency}` : "No broker linked"}</p></div>{linked.data && <span className={isLive ? "paper-tag live-tag" : "paper-tag"}>{isLive ? "LIVE · REAL MONEY" : "PAPER MODE"}</span>}</div>
      {!linked.data && <p className="auth-message">{linked.status === "loading" ? "Loading your broker account…" : linked.status === "none" ? "Link a broker in Settings → Broker to place orders." : linked.error}</p>}

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

      <div className="trade-account-row">
        <div className="trade-account-card">
          <span>Account currency</span>
          <strong>{accountCurrency}</strong>
        </div>
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

      <div className="trade-layout">
        <section className="content-card order-card">
          <div className="side-toggle"><button className={orderSide === "Buy" ? "buy active" : "buy"} onClick={() => setOrderSide("Buy")}>Buy / Long</button><button className={orderSide === "Sell" ? "sell active" : "sell"} onClick={() => setOrderSide("Sell")}>Sell / Short</button></div>
          <label className="field-label">Symbol<input list="order-symbols" value={orderSymbol} maxLength={20} onChange={(event) => { const value = event.target.value.toUpperCase(); setOrderSymbol(value); const nextSymbol = initialInstruments.find((item) => item.symbol === value); if (nextSymbol) { setTradeSymbol(nextSymbol); setLimitPrice(nextSymbol.price.replace(/,/g, "")); } }} placeholder={linked.data?.broker === "oanda" ? "EUR_USD" : "AAPL"}/><datalist id="order-symbols">{initialInstruments.map((item) => <option key={item.symbol} value={item.symbol}>{item.name}</option>)}</datalist></label>
          <div className="field-row"><label className="field-label">Order type<select disabled><option>Market</option></select></label></div>
          <div className="field-row"><label className="field-label">Quantity<input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal"/></label><label className="field-label">Reference price ({accountCurrency}, estimate only)<input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal"/></label></div>
          <div className="field-row"><label className="field-label">Stop loss (optional)<input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" placeholder="Zuri can fill this"/></label><label className="field-label">Take profit (optional)<input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} inputMode="decimal" placeholder="Zuri can fill this"/></label></div>
          <div className="order-estimate"><span>Estimated value</span><b>{formatCurrency(validOrder ? estimatedValue : 0)}</b><span>Buying power after order</span><b>{formatCurrency(buyingPowerAfter)}</b></div>
          {isLive && <label className="field-label">Type CONFIRM LIVE to place a real-money order<input value={livePhrase} onChange={(event) => setLivePhrase(event.target.value)} autoComplete="off"/></label>}
          <label className="field-label"><span><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/> I confirm this {isLive ? "LIVE" : "paper"} market order</span></label>
          {orderError && <p className="auth-error" role="alert">{orderError}</p>}
          {orderMessage && <p className="auth-message" role="status">{orderMessage}</p>}
          <button className={orderSide === "Buy" ? "submit-order buy-submit" : "submit-order sell-submit"} disabled={!validOrder || !linked.data || !confirmed || orderBusy || (isLive && livePhrase !== "CONFIRM LIVE")} onClick={() => void submitOrder()}>{orderBusy ? "Sending…" : `${orderSide} ${orderSymbol || "—"}`}</button><small className="disclaimer">{isLive ? "This sends a real order to your live broker account." : "Paper order only. No real funds will be used."}</small>
        </section>
        <section className="content-card trade-context">
          <div className="section-title"><div><span className="small-label">MARKET SNAPSHOT · DEMO</span><h2>{tradeSymbol.symbol}</h2></div><span className={tradeSymbol.up ? "positive" : "negative"}>{tradeSymbol.change}</span></div>
          <strong className="snapshot-price">{tradeSymbol.group === "Forex" ? "" : "$"}{tradeSymbol.price}</strong>
          <div className="snapshot-row"><span>Bid</span><b>{formatQuote(Math.max(0, quotePrice - spread / 2))}</b><span>Ask</span><b>{formatQuote(quotePrice + spread / 2)}</b></div>
          <div className="snapshot-row"><span>Notional</span><b>{formatCurrency(validOrder ? estimatedValue : 0)}</b><span>Exposure</span><b>{exposurePct}%</b></div>
          <div className="trade-ai-note"><span className="ai-spark">✳</span><div><b>Zuri risk check</b><p>This order would use about {exposurePct}% of your reported buying power (using your reference price). Check your size and exit plan before submitting.</p></div></div>
        </section>
      </div>
      <section className="content-card positions-card"><div className="section-title"><div><span className="small-label">PORTFOLIO</span><h2>Open positions</h2></div><span className="muted">{linked.data ? `${linked.data.positions.length} positions` : "No broker linked"}</span></div>{linked.data ? <PositionsTable positions={linked.data.positions} currency={linked.data.account.currency} /> : <p className="muted">Link a broker in Settings → Broker to see your positions.</p>}</section>
    </div>
  );
}
function PositionsTable({ positions, currency }: { positions: LinkedPosition[]; currency: string | null }) {
  if (positions.length === 0) return <p className="muted">No open positions.</p>;
  const pct = (value: number | null) => (value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`);
  return <div className="table-scroll"><table><thead><tr><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>ENTRY</th><th>MARK</th><th>UNREALIZED P&L</th><th>RETURN</th></tr></thead><tbody>{positions.map((position) => {
    const isLong = (position.side ?? "long") === "long";
    const pl = position.unrealized_pl;
    return <tr key={position.symbol}><td><b>{position.symbol}</b></td><td><span className={isLong ? "side-pill long" : "side-pill short"}>{isLong ? "Long" : "Short"}</span></td><td>{position.quantity ?? "—"}</td><td>{formatMoney(position.avg_entry_price, currency)}</td><td>{formatMoney(position.current_price, currency)}</td><td className={pl === null ? "" : pl >= 0 ? "positive" : "negative"}>{pl === null ? "—" : `${pl >= 0 ? "+" : "-"}${formatMoney(Math.abs(pl), currency)}`}</td><td className={(position.unrealized_plpc ?? 0) >= 0 ? "positive" : "negative"}>{pct(position.unrealized_plpc)}</td></tr>;
  })}</tbody></table></div>;
}
function SettingsView({
  userId,
  email,
  preferences,
  onSavePreferences,
  linked,
}: {
  linked: LinkedAccountState;
  userId: string;
  email: string;
  preferences: UserPreferences | null;
  onSavePreferences: (preferences: UserPreferences) => Promise<void>;
}) {
  const { deleteAccount, updateDisplayName, updateEmail } = useZuriAuth();
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
  const tabs: SettingsTab[] = ["Account", "Broker", "Trading", "Risk", "Platform", "Display", "Notifications", "Security"];

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
                : <button className="account-detail-value" type="button" disabled={!profile} onClick={() => { setAccountEditing(true); setAccountEditError(""); setAccountEditMessage(""); }}>{email}</button>}
            </div>
            <div className="setting-row">
              <div><b>Name</b><small>Name shown in Zuri</small></div>
              {accountEditing
                ? <input id="profile-name" name="displayName" defaultValue={profileName} maxLength={60} autoComplete="name" aria-label="Display name" />
                : <button className="account-detail-value" type="button" disabled={!profile} onClick={() => { setAccountEditing(true); setAccountEditError(""); setAccountEditMessage(""); }}>{profile?.display_name || "Add your name"}</button>}
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
        <BrokerConnections onChange={linked.refresh} />
      </>
    ),
    Broker: (
      <>
        <BrokerConnections onChange={linked.refresh} />
        <div className="settings-section">
          <span className="small-label">BROKER TOOLS</span>
          <h3>Order routing</h3>
          <div className="setting-row"><div><b>Smart routing</b><small>Use best available venue</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>One-click trading</b><small>Fast risk execution</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Show market depth</b><small>Liquidity ladder view</small></div><input type="checkbox" /></div>
        </div>
      </>
    ),
    Trading: (
      <>
        <div className="settings-section">
          <span className="small-label">ORDER SETTINGS</span>
          <h3>Execution preferences</h3>
          <div className="setting-row"><div><b>Order fill policy</b><small>Default execution handling</small></div><select value={preferencesDraft?.order_fill_policy ?? "FOK"} onChange={(event) => updatePreference("order_fill_policy", event.target.value)}><option>FOK</option><option>IOC</option><option>GTC</option><option>DAY</option></select></div>
          <div className="setting-row"><div><b>Trade confirmation</b><small>Require review before submit</small></div><input type="checkbox" checked={preferencesDraft?.trade_confirmation_required ?? true} onChange={(event) => updatePreference("trade_confirmation_required", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Enable one-click trading</b><small>Fast manual execution</small></div><input type="checkbox" checked={preferencesDraft?.one_click_trading_enabled ?? true} onChange={(event) => updatePreference("one_click_trading_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Default order type</b><small>New order baseline</small></div><select value={preferencesDraft?.default_order_type ?? "Market"} onChange={(event) => updatePreference("default_order_type", event.target.value)}><option>Market</option><option>Limit</option><option>Stop</option><option>Stop Limit</option></select></div>
        </div>
        <div className="settings-section">
          <span className="small-label">POSITION SETTINGS</span>
          <h3>Trade management</h3>
          <div className="setting-row"><div><b>Max open positions</b><small>Rolling cap per session</small></div><input type="number" min={1} max={100} value={preferencesDraft?.max_open_positions ?? 6} onChange={(event) => updatePreference("max_open_positions", Number(event.target.value))} /></div>
          <div className="setting-row"><div><b>Allow hedging</b><small>Multi-directional positions</small></div><input type="checkbox" checked={preferencesDraft?.allow_hedging ?? false} onChange={(event) => updatePreference("allow_hedging", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Auto-close on stop</b><small>Close positions on risk breach</small></div><input type="checkbox" checked={preferencesDraft?.auto_close_on_stop ?? true} onChange={(event) => updatePreference("auto_close_on_stop", event.target.checked)} /></div>
        </div>
      </>
    ),
    Risk: (
      <>
        <div className="settings-section">
          <span className="small-label">RISK CONTROLS</span>
          <h3>Portfolio discipline</h3>
          <div className="setting-row"><div><b>Max daily loss (%)</b><small>Hard stop across account</small></div><input type="number" min={0} max={100} step="0.01" value={preferencesDraft?.max_daily_loss_percent ?? 2} onChange={(event) => updatePreference("max_daily_loss_percent", Number(event.target.value))} /></div>
          <div className="setting-row"><div><b>Max trade risk (%)</b><small>Per-trade position sizing cap</small></div><input type="number" min={0} max={100} step="0.01" value={preferencesDraft?.max_trade_risk_percent ?? 0.75} onChange={(event) => updatePreference("max_trade_risk_percent", Number(event.target.value))} /></div>
          <div className="setting-row"><div><b>Max correlation exposure (%)</b><small>Risk concentration limit</small></div><input type="number" min={0} max={100} step="0.01" value={preferencesDraft?.max_correlation_exposure_percent ?? 35} onChange={(event) => updatePreference("max_correlation_exposure_percent", Number(event.target.value))} /></div>
          <div className="setting-row"><div><b>Emergency close all</b><small>One-click panic liquidation</small></div><button className="danger-button" type="button">Close all</button></div>
        </div>
      </>
    ),
    Platform: (
      <>
        <div className="settings-section">
          <span className="small-label">PLATFORM</span>
          <h3>Terminal behavior</h3>
          <div className="setting-row"><div><b>Start at login</b><small>Open workspace automatically</small></div><input type="checkbox" checked={preferencesDraft?.start_at_login_enabled ?? true} onChange={(event) => updatePreference("start_at_login_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Save chart layout</b><small>Remember active chart templates</small></div><input type="checkbox" checked={preferencesDraft?.save_chart_layout_enabled ?? true} onChange={(event) => updatePreference("save_chart_layout_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Use Turbo mode</b><small>Reduced latency UI stream</small></div><input type="checkbox" checked={preferencesDraft?.turbo_mode_enabled ?? false} onChange={(event) => updatePreference("turbo_mode_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Auto-reconnect</b><small>Restore broker session</small></div><input type="checkbox" checked={preferencesDraft?.auto_reconnect_enabled ?? true} onChange={(event) => updatePreference("auto_reconnect_enabled", event.target.checked)} /></div>
        </div>
        <div className="settings-section">
          <span className="small-label">CHARTS</span>
          <h3>Workspace defaults</h3>
          <div className="setting-row"><div><b>Default chart timeframe</b><small>When a new chart opens</small></div><select value={preferencesDraft?.default_timeframe ?? "15m"} onChange={(event) => updatePreference("default_timeframe", event.target.value)}><option>1m</option><option>5m</option><option>15m</option><option>1h</option><option>4h</option><option>1D</option><option>1W</option></select></div>
          <div className="setting-row"><div><b>Default symbol</b><small>Initial instrument selected</small></div><select value={preferencesDraft?.default_symbol ?? "BTCUSD"} onChange={(event) => updatePreference("default_symbol", event.target.value)}>{initialInstruments.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.symbol}</option>)}</select></div>
        </div>
      </>
    ),
    Display: (
      <>
        <div className="settings-section">
          <span className="small-label">DISPLAY</span>
          <h3>Theme and layout</h3>
          <div className="setting-row"><div><b>Color theme</b><small>Workspace palette</small></div><select value={preferencesDraft?.color_theme ?? "Midnight"} onChange={(event) => updatePreference("color_theme", event.target.value)}><option>Midnight</option><option>Graphite</option><option>Classic</option><option>High contrast</option></select></div>
          <div className="setting-row"><div><b>Language</b><small>Interface language</small></div><select value={preferencesDraft?.language ?? "English"} onChange={(event) => updatePreference("language", event.target.value)}><option>English</option><option>Deutsch</option><option>Français</option><option>Español</option></select></div>
          <div className="setting-row"><div><b>Time zone</b><small>Display timestamps</small></div><select value={preferencesDraft?.time_zone ?? "UTC"} onChange={(event) => updatePreference("time_zone", event.target.value)}><option>UTC</option><option>New York</option><option>London</option><option>Tokyo</option></select></div>
          <div className="setting-row"><div><b>Compact mode</b><small>Dense UI layout</small></div><input type="checkbox" checked={preferencesDraft?.compact_mode ?? false} onChange={(event) => updatePreference("compact_mode", event.target.checked)} /></div>
        </div>
      </>
    ),
    Notifications: (
      <>
        <div className="settings-section">
          <span className="small-label">ALERTS</span>
          <h3>Signal and trade notifications</h3>
          <div className="setting-row"><div><b>Price alerts</b><small>Triggered by symbol thresholds</small></div><input type="checkbox" checked={preferencesDraft?.price_alerts_enabled ?? true} onChange={(event) => updatePreference("price_alerts_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Execution notifications</b><small>Order and fill alerts</small></div><input type="checkbox" checked={preferencesDraft?.execution_notifications_enabled ?? true} onChange={(event) => updatePreference("execution_notifications_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Journal reminders</b><small>Post-trade review prompts</small></div><input type="checkbox" checked={preferencesDraft?.journal_reminders_enabled ?? true} onChange={(event) => updatePreference("journal_reminders_enabled", event.target.checked)} /></div>
          <div className="setting-row"><div><b>Desktop push</b><small>Browser and OS popups</small></div><input type="checkbox" checked={preferencesDraft?.desktop_notifications_enabled ?? false} onChange={(event) => updatePreference("desktop_notifications_enabled", event.target.checked)} /></div>
        </div>
      </>
    ),
    Security: (
      <>
        <div className="settings-section">
          <span className="small-label">SECURITY</span>
          <h3>Access and protection</h3>
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
        <nav className="settings-nav" aria-label="Settings sections">
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

        <div className="content-card settings-card">
          {tabContent[settingsTab]}
        </div>
      </div>
    </div>
  );
}

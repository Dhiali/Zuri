"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Section = "Charts" | "Dashboard" | "Trade" | "History" | "Journal" | "Settings";
type SettingsTab = "Account" | "Broker" | "Trading" | "Risk" | "Platform" | "Display" | "Notifications" | "Security";
type Instrument = { symbol: string; name: string; price: string; change: string; up: boolean; icon: string; group: string; tickDirection?: "up" | "down"; tickSequence?: number };
type JournalSide = "Watching" | "Long" | "Short";
type JournalEntry = { id: string; symbol: string; timeframe: string; side: JournalSide; setup: string; entry: string; stop: string; target: string; note: string; createdAt: string };

const initialInstruments: Instrument[] = [
  { symbol: "BTCUSD", name: "Bitcoin / U.S. Dollar", price: "85,890", change: "+1.22%", up: true, icon: "₿", group: "Crypto" },
  { symbol: "ETHUSD", name: "Ethereum / U.S. Dollar", price: "2,284.60", change: "+0.84%", up: true, icon: "◆", group: "Crypto" },
  { symbol: "SOLUSD", name: "Solana / U.S. Dollar", price: "142.82", change: "−0.36%", up: false, icon: "◎", group: "Crypto" },
  { symbol: "EURUSD", name: "Euro / U.S. Dollar", price: "1.12643", change: "+0.20%", up: true, icon: "€", group: "Forex" },
  { symbol: "GOLD", name: "Gold Spot / U.S. Dollar", price: "4,184.70", change: "+0.24%", up: true, icon: "Au", group: "Commodities" },
  { symbol: "AAPL", name: "Apple Inc.", price: "257.13", change: "−0.18%", up: false, icon: "A", group: "Stocks" },
];

const watchlistStorageKey = "zuri-watchlist-symbols";
const defaultWatchlistSnapshot = JSON.stringify(initialInstruments.map((instrument) => instrument.symbol));

function subscribeToWatchlist(onStoreChange: () => void) {
  const handleChange = () => onStoreChange();
  window.addEventListener("storage", handleChange);
  window.addEventListener("zuri-watchlist-change", handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener("zuri-watchlist-change", handleChange);
  };
}

function getWatchlistSnapshot() {
  const saved = window.localStorage.getItem(watchlistStorageKey);
  if (!saved) return defaultWatchlistSnapshot;
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const knownSymbols = new Set(initialInstruments.map((instrument) => instrument.symbol));
      return JSON.stringify([...new Set(parsed.filter((symbol): symbol is string => typeof symbol === "string" && knownSymbols.has(symbol)))]);
    }
  } catch {
    window.localStorage.removeItem(watchlistStorageKey);
  }
  return defaultWatchlistSnapshot;
}

function getServerWatchlistSnapshot() {
  return defaultWatchlistSnapshot;
}

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

function readJournalEntries(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const savedEntries = window.localStorage.getItem("zuri-journal-entries");
    return savedEntries ? JSON.parse(savedEntries) as JournalEntry[] : [];
  } catch {
    window.localStorage.removeItem("zuri-journal-entries");
    return [];
  }
}

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
  const [section, setSection] = useState<Section>("Charts");
  const [instruments, setInstruments] = useState(initialInstruments);
  const watchlistSnapshot = useSyncExternalStore(subscribeToWatchlist, getWatchlistSnapshot, getServerWatchlistSnapshot);
  const watchlistSymbols = JSON.parse(watchlistSnapshot) as string[];
  const watchlistInstruments = instruments.filter((instrument) => watchlistSymbols.includes(instrument.symbol));
  const [selectedSymbol, setSelectedSymbol] = useState(initialInstruments[0].symbol);
  const [timeframe, setTimeframe] = useState("15m");
  const [activeTool, setActiveTool] = useState("");
  const [orderSide, setOrderSide] = useState<"Buy" | "Sell">("Buy");
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [query, setQuery] = useState("");
  const [aiExpanded, setAiExpanded] = useState(false);
  const [aiOnChart, setAiOnChart] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(readJournalEntries);
  const [journalDraftOpen, setJournalDraftOpen] = useState(false);
  const [journalDraftSide, setJournalDraftSide] = useState<JournalSide>("Watching");
  const activeSymbol = watchlistSymbols.includes(selectedSymbol) ? selectedSymbol : watchlistInstruments[0]?.symbol ?? initialInstruments[0].symbol;
  const symbol = instruments.find((instrument) => instrument.symbol === activeSymbol) ?? initialInstruments.find((instrument) => instrument.symbol === activeSymbol) ?? initialInstruments[0];
  const aiBias = symbol.up ? "UPWARD BIAS" : "DOWNWARD BIAS";
  const aiBrief = `The simulated ${symbol.symbol} quote is ${symbol.change} today. Treat this as a watch cue, then verify price action and risk before placing a paper order.`;
  const searchUniverse = query.trim() ? instruments : watchlistInstruments;
  const filteredInstruments = searchUniverse.filter((item) => `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    localStorage.setItem("zuri-journal-entries", JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setInstruments((current) => current.map(advanceInstrument));
    }, 1800);
    return () => window.clearInterval(ticker);
  }, []);

  const saveJournalEntry = (entry: Omit<JournalEntry, "id" | "createdAt">) => {
    setJournalEntries((current) => [{ ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...current]);
    setJournalDraftOpen(false);
    setSection("Journal");
  };

  const removeInstrument = (symbolToRemove: string) => {
    const remainingSymbols = watchlistSymbols.filter((symbol) => symbol !== symbolToRemove);
    localStorage.setItem(watchlistStorageKey, JSON.stringify(remainingSymbols));
    window.dispatchEvent(new Event("zuri-watchlist-change"));
    const remaining = watchlistInstruments.filter((instrument) => instrument.symbol !== symbolToRemove);
    if (selectedSymbol === symbolToRemove) setSelectedSymbol(remaining[0]?.symbol ?? initialInstruments[0].symbol);
  };

  const addInstrument = (symbolToAdd: string) => {
    if (watchlistSymbols.includes(symbolToAdd)) return;
    localStorage.setItem(watchlistStorageKey, JSON.stringify([...watchlistSymbols, symbolToAdd]));
    window.dispatchEvent(new Event("zuri-watchlist-change"));
    setSelectedSymbol(symbolToAdd);
    setSection("Charts");
    setQuery("");
  };

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <a className="brand" href="#charts" onClick={() => setSection("Charts")}><span className="brand-mark">z</span><span>zuri<span className="brand-dot">.</span></span></a>
        <div className="top-divider" />
        <div className="market-strip"><span className="live-dot" /> NYSE <span className="strip-separator">/</span> NASDAQ <span className="market-open">PAPER · DEMO</span></div>
        <div className="topbar-right"><button className="icon-action" title="Search markets" onClick={() => document.getElementById("market-search")?.focus()}>⌕</button><button className="icon-action notification" title="Notifications">♧<i /></button><div className="avatar">JD</div></div>
      </header>
      <div className="workspace">
        <nav className="primary-nav" aria-label="Primary navigation">
          <div className="nav-main">{(["Charts", "Dashboard", "Trade", "History", "Journal"] as Section[]).map((item) => <button key={item} onClick={() => setSection(item)} className={section === item ? "nav-item selected" : "nav-item"} title={item}><Icon name={item}/><span>{item}</span></button>)}</div>
          <div className="nav-bottom"><button onClick={() => setSection("Settings")} className={section === "Settings" ? "nav-item selected" : "nav-item"} title="Settings"><Icon name="Settings"/><span>Settings</span></button><div className="nav-help">?</div></div>
        </nav>
        <div className="content-column">
          <div className="page-heading"><div><div className="eyebrow">PERSONAL TRADING DESK <span>•</span> FRI, OCT 02</div><h1>{section === "Charts" ? "Charts" : section}</h1></div><div className="heading-actions"><button className="outline-button">⌖ <span>Connect broker</span></button><button className="solid-button" onClick={() => { setSection("Trade"); setOrderPlaced(false); }}>＋ <span>New order</span></button></div></div>
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
          {section === "Dashboard" && <Dashboard setSection={setSection}/>}
          {section === "Trade" && <TradeView symbol={symbol} orderSide={orderSide} setOrderSide={setOrderSide} orderPlaced={orderPlaced} setOrderPlaced={setOrderPlaced}/>}
          {section === "History" && <HistoryView/>}
          {section === "Journal" && <JournalView entries={journalEntries} onNewEntry={() => { setSection("Charts"); setJournalDraftSide("Watching"); setJournalDraftOpen(true); }} onDelete={(id) => setJournalEntries((current) => current.filter((entry) => entry.id !== id))} />}
          {section === "Settings" && <SettingsView/>}
        </div>
        <aside className={watchlistOpen ? "right-rail" : "right-rail collapsed"}>
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
            <div className="news-list-title"><span>DEMO HEADLINES</span><button className="text-action">All news →</button></div>
            <div className="news-item"><span className="news-source">MARKET DESK <i>· 14m</i></span><p>Fed officials signal patience as inflation cools</p><span className="impact neutral">MACRO</span></div>
            <div className="news-item"><span className="news-source">CRYPTO PULSE <i>· 38m</i></span><p>Ethereum staking queues hit a 3-month high</p><span className="impact bullish">ETHUSD ↗</span></div>
          </>}
        </aside>
      </div>
      <footer className="statusbar"><span><i className="live-dot"/> All systems operational</span><span>Paper trading <b>ON</b></span><span>Prices in USD</span><span className="status-spacer"/><span>⌁ &nbsp;Help center</span></footer>
    </main>
  );
}

function JournalCapture({ symbol, timeframe, initialSide, onSave, onCancel }: { symbol: Instrument; timeframe: string; initialSide: JournalSide; onSave: (entry: Omit<JournalEntry, "id" | "createdAt">) => void; onCancel: () => void }) {
  return (
    <section className="journal-capture" aria-labelledby="journal-capture-title">
      <div className="journal-capture-heading"><div><span className="small-label">CHART JOURNAL · {symbol.symbol} · {timeframe}</span><h2 id="journal-capture-title">Capture your plan</h2></div><button className="icon-action" title="Close journal capture" onClick={onCancel}>×</button></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSave({ symbol: symbol.symbol, timeframe, side: String(form.get("side")) as JournalSide, setup: String(form.get("setup")), entry: String(form.get("entry")), stop: String(form.get("stop")), target: String(form.get("target")), note: String(form.get("note")).trim() });
      }}>
        <div className="journal-fields">
          <label className="field-label">Setup<select name="setup" defaultValue="Trade idea"><option>Trade idea</option><option>Pre-trade plan</option><option>Entry review</option><option>Exit review</option><option>Post-trade lesson</option></select></label>
          <label className="field-label">Direction<select name="side" defaultValue={initialSide}><option>Watching</option><option>Long</option><option>Short</option></select></label>
          <label className="field-label">Entry price<input name="entry" inputMode="decimal" placeholder="Optional" /></label>
          <label className="field-label">Stop loss<input name="stop" inputMode="decimal" placeholder="Optional" /></label>
          <label className="field-label">Target price<input name="target" inputMode="decimal" placeholder="Optional" /></label>
        </div>
        <label className="field-label journal-note-field">Thesis and notes<textarea name="note" required rows={3} placeholder="What is the setup, what confirms it, and what invalidates it?" /></label>
        <div className="journal-capture-footer"><span>Saved in this browser · chart drawings are not attached</span><div><button type="button" className="outline-button" onClick={onCancel}>Cancel</button><button type="submit" className="solid-button">Save to journal</button></div></div>
      </form>
    </section>
  );
}

function JournalView({ entries, onNewEntry, onDelete }: { entries: JournalEntry[]; onNewEntry: () => void; onDelete: (id: string) => void }) {
  return (
    <div className="secondary-view journal-view">
      <div className="section-title journal-view-heading"><div><span className="small-label">CHART-LINKED NOTES · SAVED LOCALLY</span><h2>Trading journal</h2></div><button className="solid-button" onClick={onNewEntry}>＋ <span>New entry</span></button></div>
      {entries.length === 0 ? <div className="content-card journal-empty"><span className="small-label">NO ENTRIES YET</span><h3>Start with a chart idea</h3><p>Capture a setup, define your risk, and write down what would invalidate the trade.</p><button className="outline-button" onClick={onNewEntry}>Open chart and write a note</button></div> : <div className="journal-entry-list">{entries.map((entry) => <article className="content-card journal-entry" key={entry.id}>
        <div className="journal-entry-heading"><div><span className="small-label">{entry.setup} · {entry.timeframe}</span><h3>{entry.symbol} <span className={`side-pill ${entry.side === "Short" ? "short" : entry.side === "Long" ? "long" : "watching"}`}>{entry.side}</span></h3></div><div className="journal-entry-actions"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time><button className="text-action" onClick={() => onDelete(entry.id)} aria-label={`Delete ${entry.symbol} journal entry`}>Delete</button></div></div>
        <p>{entry.note}</p>
        <div className="journal-plan-values"><span>Entry <b>{entry.entry || "—"}</b></span><span>Stop <b>{entry.stop || "—"}</b></span><span>Target <b>{entry.target || "—"}</b></span></div>
      </article>)}</div>}
    </div>
  );
}

function Dashboard({ setSection }: { setSection: (section: Section) => void }) {
  return <div className="secondary-view"><div className="dashboard-greeting"><div><span className="small-label">FRIDAY, OCTOBER 02, 2026</span><h2>Good afternoon, Jordan.</h2><p>Here’s the signal behind your numbers today.</p></div><button className="solid-button" onClick={() => setSection("Trade")}>＋ <span>New order</span></button></div><div className="stat-grid"><Metric label="Net liquidation" value="$24,680.42" change="+$1,284.20 (5.49%)"/><Metric label="Today's P&L" value="+$284.60" change="+1.17% today"/><Metric label="Win rate" value="64.8%" change="Last 30 days"/><Metric label="Open positions" value="3" change="$8,420 deployed"/></div><div className="dashboard-columns"><section className="content-card performance-card"><div className="section-title"><div><span className="small-label">PORTFOLIO PERFORMANCE</span><h2>Account growth</h2></div><select aria-label="Performance period"><option>30 days</option><option>90 days</option><option>1 year</option></select></div><div className="performance-total">$24,680 <span>+5.49%</span></div><div className="performance-chart"><svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-label="Portfolio growth line"><defs><linearGradient id="performance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#38c49a" stopOpacity=".22"/><stop offset="1" stopColor="#38c49a" stopOpacity="0"/></linearGradient></defs><path d="M0 156 C45 151 54 132 92 140 S145 112 179 127 S236 90 265 106 S315 72 347 87 S395 69 425 78 S467 42 510 55 S551 38 582 48 S635 19 700 24 L700 190 L0 190Z" fill="url(#performance-fill)"/><path d="M0 156 C45 151 54 132 92 140 S145 112 179 127 S236 90 265 106 S315 72 347 87 S395 69 425 78 S467 42 510 55 S551 38 582 48 S635 19 700 24" fill="none" stroke="#39c99e" strokeWidth="2.5"/></svg></div><div className="performance-dates"><span>SEP 03</span><span>SEP 10</span><span>SEP 17</span><span>SEP 24</span><span>OCT 02</span></div></section><section className="content-card advice-card"><div className="ai-heading"><span className="ai-spark">✳</span><span className="small-label">ZURI · ACCOUNT COACH</span></div><h2>Protect your gains on high-volatility days.</h2><p>Your average position size is 28% larger than last month. On days your exposure exceeds $7,500, your drawdown has historically doubled.</p><div className="advice-stat"><span>Current exposure</span><b>$8,420 <i>Above your $7,500 threshold</i></b></div><button className="outline-button">Review open positions →</button><small>Based on your last 90 days · Not financial advice</small></section></div><section className="content-card positions-card"><div className="section-title"><div><span className="small-label">ACCOUNT</span><h2>Open positions</h2></div><button className="text-action" onClick={() => setSection("Trade")}>Trade →</button></div><PositionsTable/></section></div>;
}
function Metric({ label, value, change }: { label: string; value: string; change: string }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small className={change.startsWith("+") ? "positive" : "muted"}>{change}</small></div>; }
function TradeView({ symbol, orderSide, setOrderSide, orderPlaced, setOrderPlaced }: { symbol: Instrument; orderSide: "Buy" | "Sell"; setOrderSide: (side: "Buy" | "Sell") => void; orderPlaced: boolean; setOrderPlaced: (placed: boolean) => void }) {
  const [tradeSymbol, setTradeSymbol] = useState(symbol);
  const [quantity, setQuantity] = useState("0.025");
  const [limitPrice, setLimitPrice] = useState(symbol.price.replace(/,/g, ""));
  const accountCurrency = "USD";
  const balance = 24680.42;
  const equity = 24782.18;
  const freeMargin = 17362.18;
  const buyingPower = 24680.42;
  const quantityValue = Number(quantity);
  const priceValue = Number(limitPrice);
  const estimatedValue = quantityValue * priceValue;
  const validOrder = Number.isFinite(estimatedValue) && estimatedValue > 0;
  const buyingPowerAfter = Math.max(0, buyingPower - (orderSide === "Buy" && validOrder ? estimatedValue : 0));
  const quotePrecision = tradeSymbol.group === "Forex" ? 5 : 2;
  const quotePrice = Number(tradeSymbol.price.replace(/,/g, ""));
  const spread = quotePrice * (tradeSymbol.group === "Forex" ? 0.0001 : 0.00007);
  const formatCurrency = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatQuote = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: quotePrecision, maximumFractionDigits: quotePrecision });

  return (
    <div className="secondary-view trade-view">
      <div className="trade-intro"><div><span className="small-label">ORDER TICKET</span><h2>Place an order</h2><p>Paper trading account · {accountCurrency} account</p></div><span className="paper-tag">PAPER MODE</span></div>

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
          <span>Free margin</span>
          <strong>{formatCurrency(freeMargin)}</strong>
        </div>
      </div>

      <div className="trade-layout">
        <section className="content-card order-card">
          <div className="side-toggle"><button className={orderSide === "Buy" ? "buy active" : "buy"} onClick={() => setOrderSide("Buy")}>Buy / Long</button><button className={orderSide === "Sell" ? "sell active" : "sell"} onClick={() => setOrderSide("Sell")}>Sell / Short</button></div>
          <label className="field-label">Symbol<select value={tradeSymbol.symbol} onChange={(event) => { const nextSymbol = initialInstruments.find((item) => item.symbol === event.target.value); if (nextSymbol) { setTradeSymbol(nextSymbol); setLimitPrice(nextSymbol.price.replace(/,/g, "")); } }}>{initialInstruments.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.name}</option>)}</select></label>
          <div className="field-row"><label className="field-label">Order type<select><option>Market</option><option>Limit</option><option>Stop</option><option>Stop limit</option></select></label><label className="field-label">Time in force<select><option>Good for day</option><option>Good till canceled</option></select></label></div>
          <div className="field-row"><label className="field-label">Quantity<input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal"/></label><label className="field-label">Limit price ({accountCurrency})<input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal"/></label></div>
          <div className="order-estimate"><span>Estimated value</span><b>{formatCurrency(validOrder ? estimatedValue : 0)}</b><span>Buying power after order</span><b>{formatCurrency(buyingPowerAfter)}</b></div>
          <button className={orderSide === "Buy" ? "submit-order buy-submit" : "submit-order sell-submit"} disabled={!validOrder} onClick={() => setOrderPlaced(true)}>{orderPlaced ? "Order submitted ✓" : `${orderSide} ${tradeSymbol.symbol}`}</button><small className="disclaimer">Paper order only. No real funds will be used.</small>
        </section>
        <section className="content-card trade-context">
          <div className="section-title"><div><span className="small-label">MARKET SNAPSHOT · DEMO</span><h2>{tradeSymbol.symbol}</h2></div><span className={tradeSymbol.up ? "positive" : "negative"}>{tradeSymbol.change}</span></div>
          <strong className="snapshot-price">{tradeSymbol.group === "Forex" ? "" : "$"}{tradeSymbol.price}</strong>
          <div className="snapshot-row"><span>Bid</span><b>{formatQuote(Math.max(0, quotePrice - spread / 2))}</b><span>Ask</span><b>{formatQuote(quotePrice + spread / 2)}</b></div>
          <div className="snapshot-row"><span>Notional</span><b>{formatCurrency(validOrder ? estimatedValue : 0)}</b><span>Exposure</span><b>{((validOrder ? estimatedValue : 0) / buyingPower * 100).toFixed(1)}%</b></div>
          <div className="trade-ai-note"><span className="ai-spark">✳</span><div><b>Zuri risk check · demo</b><p>This paper order uses {((validOrder ? estimatedValue : 0) / buyingPower * 100).toFixed(1)}% of the demo account value. Check your size and exit plan before submitting.</p></div></div>
        </section>
      </div>
      <section className="content-card positions-card"><div className="section-title"><div><span className="small-label">PORTFOLIO</span><h2>Open positions</h2></div><span className="muted">3 positions</span></div><PositionsTable/></section>
    </div>
  );
}
function PositionsTable() {
  const rows = [["BTCUSD", "Long", "$84,620.00", "$85,890.00", "+$126.80", "+1.50%"], ["ETHUSD", "Long", "$2,241.20", "$2,284.60", "+$86.80", "+1.94%"], ["SOLUSD", "Short", "$145.30", "$142.82", "+$49.60", "+1.71%"]];
  return <div className="table-scroll"><table><thead><tr><th>SYMBOL</th><th>SIDE</th><th>ENTRY</th><th>MARK</th><th>UNREALIZED P&L</th><th>RETURN</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><td><b>{row[0]}</b></td><td><span className={row[1] === "Long" ? "side-pill long" : "side-pill short"}>{row[1]}</span></td><td>{row[2]}</td><td>{row[3]}</td><td className="positive">{row[4]}</td><td className="positive">{row[5]}</td></tr>)}</tbody></table></div>;
}
function HistoryView() {
  type HistoryTab = "positions" | "orders" | "deals";
  type HistoryPeriod = "Today" | "Last week" | "Last month" | "Last 3 months" | "Last 6 months" | "All time";
  type SortKey = "default" | "symbol" | "ticket" | "type" | "volume" | "openTime" | "closeTime" | "profit";

  const [activeTab, setActiveTab] = useState<HistoryTab>("positions");
  const [period, setPeriod] = useState<HistoryPeriod>("Last month");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const historyRows = {
    positions: [
      { ticket: 412881, symbol: "BTCUSD", type: "Long", volume: "0.025 BTC", openTime: "2026-10-02T14:32:00", closeTime: "—", profit: "+$126.80", period: "Last week" },
      { ticket: 412734, symbol: "ETHUSD", type: "Long", volume: "2.00 ETH", openTime: "2026-09-28T11:10:00", closeTime: "—", profit: "+$86.80", period: "Last month" },
      { ticket: 412602, symbol: "SOLUSD", type: "Short", volume: "20 SOL", openTime: "2026-09-18T09:42:00", closeTime: "—", profit: "+$49.60", period: "Last 3 months" },
      { ticket: 412414, symbol: "EURUSD", type: "Short", volume: "4.5 lots", openTime: "2026-08-25T08:15:00", closeTime: "—", profit: "-$28.20", period: "Last 6 months" },
    ],
    orders: [
      { ticket: 412881, symbol: "BTCUSD", type: "Buy", volume: "0.025 BTC", openTime: "2026-10-02T14:32:00", closeTime: "2026-10-02T14:32:10", profit: "+$126.80", period: "Last week" },
      { ticket: 412834, symbol: "ETHUSD", type: "Sell", volume: "2.00 ETH", openTime: "2026-09-30T12:19:00", closeTime: "2026-09-30T12:20:15", profit: "+$42.40", period: "Last month" },
      { ticket: 412739, symbol: "AAPL", type: "Buy", volume: "140 shares", openTime: "2026-09-18T15:04:00", closeTime: "2026-09-18T15:04:25", profit: "+$312.60", period: "Last 3 months" },
      { ticket: 412636, symbol: "NVDA", type: "Sell", volume: "80 shares", openTime: "2026-08-29T09:08:00", closeTime: "2026-08-29T09:09:10", profit: "+$184.50", period: "Last 6 months" },
    ],
    deals: [
      { ticket: 412881, symbol: "BTCUSD", type: "Buy", volume: "0.025 BTC", openTime: "2026-10-02T14:32:00", closeTime: "2026-10-02T14:32:10", profit: "+$126.80", period: "Today" },
      { ticket: 412734, symbol: "ETHUSD", type: "Sell", volume: "1.00 ETH", openTime: "2026-09-29T18:41:00", closeTime: "2026-09-29T18:42:45", profit: "+$85.10", period: "Last week" },
      { ticket: 412612, symbol: "SOLUSD", type: "Sell", volume: "18 SOL", openTime: "2026-09-14T10:55:00", closeTime: "2026-09-14T11:02:00", profit: "+$44.30", period: "Last month" },
      { ticket: 412481, symbol: "EURUSD", type: "Buy", volume: "1.2 lots", openTime: "2026-08-15T07:18:00", closeTime: "2026-08-15T07:21:20", profit: "+$63.75", period: "Last 3 months" },
      { ticket: 412390, symbol: "GOLD", type: "Buy", volume: "0.60 lots", openTime: "2026-07-12T15:32:00", closeTime: "2026-07-12T16:04:00", profit: "+$118.30", period: "Last 6 months" },
    ],
  } as const;

  const periodOptions: HistoryPeriod[] = ["Today", "Last week", "Last month", "Last 3 months", "Last 6 months", "All time"];
  const selectOptions: SortKey[] = ["default", "symbol", "ticket", "type", "volume", "openTime", "closeTime", "profit"];
  const sortLabels: Record<SortKey, string> = {
    default: "Default",
    symbol: "Symbol",
    ticket: "Ticket",
    type: "Type",
    volume: "Volume",
    openTime: "Open time",
    closeTime: "Close time",
    profit: "Profit",
  };

  const getRowValue = (row: (typeof historyRows)[HistoryTab][number], key: SortKey) => {
    switch (key) {
      case "symbol": return row.symbol.toLowerCase();
      case "ticket": return row.ticket;
      case "type": return row.type.toLowerCase();
      case "volume": {
        const match = row.volume.match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : 0;
      }
      case "openTime": return new Date(row.openTime).getTime();
      case "closeTime": return row.closeTime === "—" ? 0 : new Date(row.closeTime).getTime();
      case "profit": {
        const value = Number(String(row.profit).replace(/[$,+]/g, ""));
        return Number.isFinite(value) ? value : 0;
      }
      default:
        return new Date(row.closeTime === "—" ? row.openTime : row.closeTime).getTime();
    }
  };

  const getFilteredRows = () => {
    const rows = [...historyRows[activeTab]];
    const periodIndex = periodOptions.indexOf(period);

    return rows.filter((row) => {
      if (period === "All time") return true;
      const rowIndex = periodOptions.indexOf((row.period as HistoryPeriod) ?? "All time");
      return rowIndex <= periodIndex && rowIndex >= 0;
    }).sort((left, right) => {
      const leftValue = getRowValue(left, sortKey);
      const rightValue = getRowValue(right, sortKey);
      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return sortDirection === "asc" ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
      }
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
      }
      return 0;
    });
  };

  const visibleRows = getFilteredRows();
  const totalProfit = visibleRows.reduce((sum, row) => {
    const numeric = Number(String(row.profit).replace(/[$,+]/g, ""));
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);

  const updateSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "profit" ? "desc" : "asc");
  };

  const statusClass = (value: string) => value.includes("-") ? "negative" : "positive";

  return (
    <div className="secondary-view">
      <div className="section-title history-title">
        <div>
          <span className="small-label">PAPER ACCOUNT · TRADE LOG</span>
          <h2>History</h2>
        </div>
        <button className="outline-button" type="button">⇩ <span>Export CSV</span></button>
      </div>

      <div className="content-card history-card">
        <div className="history-toolbar">
          <div className="history-tabs" aria-label="History tabs">
            {(["positions", "orders", "deals"] as HistoryTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={activeTab === tab ? "history-tab active" : "history-tab"}
                onClick={() => setActiveTab(tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="history-controls">
            <label className="history-filter">
              <span>Period</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value as HistoryPeriod)}>
                {periodOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className="history-filter">
              <span>Sort by</span>
              <select value={sortKey} onChange={(event) => updateSort(event.target.value as SortKey)}>
                {selectOptions.map((option) => <option key={option} value={option}>{sortLabels[option]}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("ticket")}>Ticket</button></th>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("symbol")}>Symbol</button></th>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("type")}>Type</button></th>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("volume")}>Volume</button></th>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("openTime")}>Open time</button></th>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("closeTime")}>Close time</button></th>
                <th><button type="button" className="history-sort-button" onClick={() => updateSort("profit")}>Profit</button></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${activeTab}-${row.ticket}-${row.symbol}`}>
                  <td><b>{row.ticket}</b></td>
                  <td>{row.symbol}</td>
                  <td><span className={row.type === "Long" || row.type === "Buy" ? "side-pill long" : "side-pill short"}>{row.type}</span></td>
                  <td>{row.volume}</td>
                  <td>{new Date(row.openTime).toLocaleString()}</td>
                  <td>{row.closeTime === "—" ? "Open" : new Date(row.closeTime).toLocaleString()}</td>
                  <td className={statusClass(String(row.profit))}>{row.profit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="history-summary">
        <span>{visibleRows.length} records in {period}</span>
        <span>Total {activeTab === "positions" ? "floating" : "realized"} P&L <b className={totalProfit >= 0 ? "positive" : "negative"}>{totalProfit >= 0 ? "+" : "-"}${Math.abs(totalProfit).toFixed(2)}</b></span>
      </div>
    </div>
  );
}
function SettingsView() {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("Account");
  const tabs: SettingsTab[] = ["Account", "Broker", "Trading", "Risk", "Platform", "Display", "Notifications", "Security"];

  const accountSummary = [
    { label: "Account name", value: "Zuri Prime Demo" },
    { label: "Login", value: "ZT-20491" },
    { label: "Balance", value: "$24,680.42" },
    { label: "Equity", value: "$24,782.18" },
    { label: "Margin", value: "$7,420.00" },
    { label: "Free margin", value: "$17,362.18" },
    { label: "Leverage", value: "1:100" },
    { label: "Currency", value: "USD" },
  ];

  const brokerSummary = [
    { label: "Broker", value: "Zuri Markets Execution" },
    { label: "Server", value: "ZuriPrime-Demo" },
    { label: "Status", value: "Connected" },
    { label: "Type", value: "Paper / Simulated" },
    { label: "Latency", value: "18 ms" },
    { label: "Trade mode", value: "Demo" },
    { label: "Execution policy", value: "Netting" },
    { label: "Support", value: "24/7" },
  ];

  const tabContent: Record<SettingsTab, React.ReactNode> = {
    Account: (
      <>
        <div className="settings-hero">
          <div>
            <span className="small-label">ACCOUNT STATUS</span>
            <h3>Connected and ready</h3>
          </div>
          <span className="status-chip success">online</span>
        </div>
        <div className="account-stat-grid">
          {accountSummary.map((item) => (
            <div key={item.label} className="summary-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </>
    ),
    Broker: (
      <>
        <div className="settings-section">
          <span className="small-label">BROKER DETAILS</span>
          <h3>Execution profile</h3>
          <div className="setting-row"><div><b>Broker name</b><small>Connected brokerage entity</small></div><select defaultValue="Zuri Markets Execution"><option>Zuri Markets Execution</option><option>PrimeFlow Desk</option><option>DirectFX Gateway</option></select></div>
          <div className="setting-row"><div><b>Server</b><small>Execution environment</small></div><select defaultValue="ZuriPrime-Demo"><option>ZuriPrime-Demo</option><option>ZuriPrime-Live</option><option>PrimeFlow-Alpha</option></select></div>
          <div className="setting-row"><div><b>Login</b><small>Broker account login ID</small></div><input type="text" defaultValue="ZT-20491" /></div>
          <div className="setting-row"><div><b>Connection mode</b><small>Gateway or direct routing</small></div><select defaultValue="Auto"><option>Auto</option><option>Direct</option><option>Proxy</option></select></div>
        </div>
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
          <div className="setting-row"><div><b>Order fill policy</b><small>Default execution handling</small></div><select defaultValue="FOK"><option>FOK</option><option>IOC</option><option>GTC</option><option>DAY</option></select></div>
          <div className="setting-row"><div><b>Trade confirmation</b><small>Require review before submit</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Enable one-click trading</b><small>Fast manual execution</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Default order type</b><small>New order baseline</small></div><select defaultValue="Market"><option>Market</option><option>Limit</option><option>Stop</option><option>Stop Limit</option></select></div>
        </div>
        <div className="settings-section">
          <span className="small-label">POSITION SETTINGS</span>
          <h3>Trade management</h3>
          <div className="setting-row"><div><b>Max open positions</b><small>Rolling cap per session</small></div><input type="number" defaultValue={6} /></div>
          <div className="setting-row"><div><b>Allow hedging</b><small>Multi-directional positions</small></div><input type="checkbox" /></div>
          <div className="setting-row"><div><b>Auto-close on stop</b><small>Close positions on risk breach</small></div><input type="checkbox" defaultChecked /></div>
        </div>
      </>
    ),
    Risk: (
      <>
        <div className="settings-section">
          <span className="small-label">RISK CONTROLS</span>
          <h3>Portfolio discipline</h3>
          <div className="setting-row"><div><b>Max daily loss</b><small>Hard stop across account</small></div><input type="text" defaultValue="2.00%" /></div>
          <div className="setting-row"><div><b>Max trade risk</b><small>Per-trade position sizing cap</small></div><input type="text" defaultValue="0.75%" /></div>
          <div className="setting-row"><div><b>Max correlation exposure</b><small>Risk concentration limit</small></div><input type="text" defaultValue="35%" /></div>
          <div className="setting-row"><div><b>Emergency close all</b><small>One-click panic liquidation</small></div><button className="danger-button" type="button">Close all</button></div>
        </div>
      </>
    ),
    Platform: (
      <>
        <div className="settings-section">
          <span className="small-label">PLATFORM</span>
          <h3>Terminal behavior</h3>
          <div className="setting-row"><div><b>Start at login</b><small>Open workspace automatically</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Save chart layout</b><small>Remember active chart templates</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Use Turbo mode</b><small>Reduced latency UI stream</small></div><input type="checkbox" /></div>
          <div className="setting-row"><div><b>Auto-reconnect</b><small>Restore broker session</small></div><input type="checkbox" defaultChecked /></div>
        </div>
        <div className="settings-section">
          <span className="small-label">CHARTS</span>
          <h3>Workspace defaults</h3>
          <div className="setting-row"><div><b>Default chart timeframe</b><small>When a new chart opens</small></div><select defaultValue="15m"><option>1m</option><option>5m</option><option>15m</option><option>1h</option><option>4h</option></select></div>
          <div className="setting-row"><div><b>Default symbol</b><small>Initial instrument selected</small></div><select defaultValue="BTCUSD"><option>BTCUSD</option><option>ETHUSD</option><option>AAPL</option><option>EURUSD</option></select></div>
        </div>
      </>
    ),
    Display: (
      <>
        <div className="settings-section">
          <span className="small-label">DISPLAY</span>
          <h3>Theme and layout</h3>
          <div className="setting-row"><div><b>Color theme</b><small>Workspace palette</small></div><select defaultValue="Midnight"><option>Midnight</option><option>Graphite</option><option>Classic</option><option>High contrast</option></select></div>
          <div className="setting-row"><div><b>Language</b><small>Interface language</small></div><select defaultValue="English"><option>English</option><option>Deutsch</option><option>Français</option><option>Español</option></select></div>
          <div className="setting-row"><div><b>Time zone</b><small>Display timestamps</small></div><select defaultValue="UTC"><option>UTC</option><option>New York</option><option>London</option><option>Tokyo</option></select></div>
          <div className="setting-row"><div><b>Compact mode</b><small>Dense UI layout</small></div><input type="checkbox" /></div>
        </div>
      </>
    ),
    Notifications: (
      <>
        <div className="settings-section">
          <span className="small-label">ALERTS</span>
          <h3>Signal and trade notifications</h3>
          <div className="setting-row"><div><b>Price alerts</b><small>Triggered by symbol thresholds</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Execution notifications</b><small>Order and fill alerts</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Journal reminders</b><small>Post-trade review prompts</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Desktop push</b><small>Browser and OS popups</small></div><input type="checkbox" /></div>
        </div>
      </>
    ),
    Security: (
      <>
        <div className="settings-section">
          <span className="small-label">SECURITY</span>
          <h3>Access and protection</h3>
          <div className="setting-row"><div><b>Two-factor auth</b><small>App-level verification</small></div><input type="checkbox" defaultChecked /></div>
          <div className="setting-row"><div><b>Session timeout</b><small>Inactivity lock period</small></div><select defaultValue="30 min"><option>10 min</option><option>30 min</option><option>1 hour</option><option>4 hours</option></select></div>
          <div className="setting-row"><div><b>Hide account values</b><small>Mask sensitive numbers</small></div><input type="checkbox" /></div>
          <div className="setting-row"><div><b>Export permissions</b><small>Allow CSV and PDF reports</small></div><input type="checkbox" defaultChecked /></div>
        </div>
      </>
    ),
  };

  return (
    <div className="secondary-view settings-view">
      <div className="section-title settings-header">
        <div>
          <span className="small-label">PREFERENCES</span>
          <h2>Settings</h2>
        </div>
        <button className="solid-button" type="button">✓ <span>Save changes</span></button>
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

      <div className="settings-footer">
        <div className="settings-footer-card">
          <span className="small-label">BROKER STATUS</span>
          <strong>{brokerSummary[2].value}</strong>
        </div>
        <div className="settings-footer-card">
          <span className="small-label">ENVIRONMENT</span>
          <strong>{brokerSummary[6].value}</strong>
        </div>
        <div className="settings-footer-card">
          <span className="small-label">ACCOUNT</span>
          <strong>{accountSummary[1].value}</strong>
        </div>
      </div>
    </div>
  );
}

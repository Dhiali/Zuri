"use client";

import { useState } from "react";

type Section = "Markets" | "Dashboard" | "Trade" | "History" | "Settings";
type Instrument = { symbol: string; name: string; price: string; change: string; up: boolean; icon: string; group: string };

const instruments: Instrument[] = [
  { symbol: "BTCUSD", name: "Bitcoin / U.S. Dollar", price: "85,890", change: "+1.22%", up: true, icon: "₿", group: "Crypto" },
  { symbol: "ETHUSD", name: "Ethereum / U.S. Dollar", price: "2,284.60", change: "+0.84%", up: true, icon: "◆", group: "Crypto" },
  { symbol: "SOLUSD", name: "Solana / U.S. Dollar", price: "142.82", change: "−0.36%", up: false, icon: "◎", group: "Crypto" },
  { symbol: "EURUSD", name: "Euro / U.S. Dollar", price: "1.12643", change: "+0.20%", up: true, icon: "€", group: "Forex" },
  { symbol: "GOLD", name: "Gold Spot / U.S. Dollar", price: "4,184.70", change: "+0.24%", up: true, icon: "Au", group: "Commodities" },
  { symbol: "AAPL", name: "Apple Inc.", price: "257.13", change: "−0.18%", up: false, icon: "A", group: "Stocks" },
];

const chartTools = ["＋", "╱", "⌁", "⌖", "⌕", "T", "◉", "⌁", "⊞", "⌂", "◌", "♧"];
const timeframes = ["1m", "5m", "15m", "1h", "4h", "1D", "1W"];
const candles = Array.from({ length: 78 }, (_, index) => {
  const trend = index < 34 ? 0.16 : index < 53 ? -0.06 : 0.27;
  const wave = Math.sin(index * 0.63) * 0.72 + Math.sin(index * 1.73) * 0.32;
  const open = 57 - index * trend + wave;
  const close = open + Math.sin(index * 2.19) * 1.35 + trend * 1.8;
  return { x: 28 + index * 11, open, close, high: Math.min(open, close) - (0.4 + (index % 4) * 0.15), low: Math.max(open, close) + (0.5 + (index % 3) * 0.18), up: close < open };
});

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Markets: "M3 3v18h18M7 14l4-4 3 3 6-7",
    Dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
    Trade: "M4 18V6m0 12h16M8 14l3-4 3 2 5-6",
    History: "M3 12a9 9 0 1 0 2.6-6.4L3 8m0-5v5h5m4-1v5l4 2",
    Settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.Markets} /></svg>;
}

function Chart({ symbol, timeframe, drawing, aiOnChart }: { symbol: Instrument; timeframe: string; drawing: string; aiOnChart: boolean }) {
  const isPositive = symbol.up;
  const selectedCandles = candles.map((candle, index) => ({ ...candle, close: candle.close + (isPositive ? -index * 0.015 : index * 0.01) }));
  return (
    <div className="chart-wrap">
      <svg className="price-chart" viewBox="0 0 1000 540" preserveAspectRatio="none" role="img" aria-label={`${symbol.symbol} candlestick chart`}>
        <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={isPositive ? "#35c7a0" : "#f26e68"} stopOpacity=".13"/><stop offset="100%" stopColor={isPositive ? "#35c7a0" : "#f26e68"} stopOpacity="0"/></linearGradient></defs>
        {[70, 150, 230, 310, 390, 470].map((y) => <g key={y}><line x1="0" x2="1000" y1={y} y2={y} className="gridline"/><text x="948" y={y - 5} className="axis-label">{(87.2 - y * 0.008).toFixed(1)}k</text></g>)}
        {[80, 250, 420, 590, 760, 930].map((x) => <line key={x} x1={x} x2={x} y1="15" y2="495" className="gridline vertical"/>)}
        <path d={`M ${selectedCandles.map((item) => `${item.x},${item.close * 5.8 - 65}`).join(" L ")} L 875,495 L 28,495 Z`} fill="url(#chart-fill)" opacity=".75" />
        {selectedCandles.map((item, index) => {
          const top = Math.min(item.open, item.close) * 5.8 - 65;
          const bottom = Math.max(item.open, item.close) * 5.8 - 65;
          const color = item.up ? "#39c99e" : "#f27670";
          return <g key={index} className="candle"><line x1={item.x} x2={item.x} y1={item.high * 5.8 - 65} y2={item.low * 5.8 - 65} stroke={color} strokeWidth="1.3"/><rect x={item.x - 3.2} y={top} width="6.4" height={Math.max(3, bottom - top)} fill={color} rx=".5"/></g>;
        })}
        <polyline points={selectedCandles.slice(10, 67).map((item, index) => `${item.x},${item.close * 5.8 - 65 + Math.sin(index / 4) * 15}`).join(" ")} fill="none" stroke="#efbd61" strokeWidth="1.4" opacity=".7" />
        {aiOnChart && <g className="ai-chart-overlay"><line x1="490" x2="918" y1="276" y2="276" stroke="#b99aff" strokeWidth="1.5" strokeDasharray="5 5"/><rect x="722" y="252" width="194" height="19" rx="3" fill="#352c43"/><text x="730" y="265" className="ai-chart-label">✳ AI RESISTANCE · $86.2K</text></g>}
        <line x1="0" x2="1000" y1="226" y2="226" stroke={isPositive ? "#35c7a0" : "#f26e68"} strokeDasharray="4 4" opacity=".8" />
        <rect x="928" y="211" width="68" height="29" fill={isPositive ? "#159b7d" : "#d95854"} rx="3"/><text x="935" y="224" className="last-price">{symbol.price}</text><text x="935" y="235" className="last-time">{timeframe} · 00:42</text>
        <text x="22" y="526" className="axis-label">09:00</text><text x="212" y="526" className="axis-label">11:00</text><text x="416" y="526" className="axis-label">13:00</text><text x="618" y="526" className="axis-label">15:00</text><text x="820" y="526" className="axis-label">17:00</text>
        {drawing === "╱" && <line x1="190" y1="354" x2="760" y2="178" stroke="#e8c16d" strokeWidth="2" strokeDasharray="6 5"/>}
      </svg>
      <div className="volume-bars">{candles.map((item, index) => <i key={index} style={{ height: `${10 + Math.abs(Math.sin(index * 3.2)) * (index > 55 && index < 62 ? 72 : 24)}%`, background: item.up ? "#2eaa8a" : "#cf625d" }} />)}</div>
      <div className="chart-watermark">ZURI <span>MARKETS</span></div>
    </div>
  );
}

export default function Home() {
  const [section, setSection] = useState<Section>("Markets");
  const [symbol, setSymbol] = useState(instruments[0]);
  const [timeframe, setTimeframe] = useState("15m");
  const [activeTool, setActiveTool] = useState("");
  const [orderSide, setOrderSide] = useState<"Buy" | "Sell">("Buy");
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [query, setQuery] = useState("");
  const [aiExpanded, setAiExpanded] = useState(false);
  const [aiOnChart, setAiOnChart] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const filteredInstruments = instruments.filter((item) => `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <a className="brand" href="#markets" onClick={() => setSection("Markets")}><span className="brand-mark">z</span><span>zuri<span className="brand-dot">.</span></span></a>
        <div className="top-divider" />
        <div className="market-strip"><span className="live-dot" /> NYSE <span className="strip-separator">/</span> NASDAQ <span className="market-open">PAPER · DEMO</span></div>
        <div className="topbar-right"><button className="icon-action" title="Search markets" onClick={() => document.getElementById("market-search")?.focus()}>⌕</button><button className="icon-action notification" title="Notifications">♧<i /></button><div className="avatar">JD</div></div>
      </header>
      <div className="workspace">
        <nav className="primary-nav" aria-label="Primary navigation">
          <div className="nav-main">{(["Markets", "Dashboard", "Trade", "History"] as Section[]).map((item) => <button key={item} onClick={() => setSection(item)} className={section === item ? "nav-item selected" : "nav-item"} title={item}><Icon name={item}/><span>{item}</span></button>)}</div>
          <div className="nav-bottom"><button onClick={() => setSection("Settings")} className={section === "Settings" ? "nav-item selected" : "nav-item"} title="Settings"><Icon name="Settings"/><span>Settings</span></button><div className="nav-help">?</div></div>
        </nav>
        <div className="content-column">
          <div className="page-heading"><div><div className="eyebrow">PERSONAL TRADING DESK <span>•</span> FRI, OCT 02</div><h1>{section === "Markets" ? "Markets" : section}</h1></div><div className="heading-actions"><button className="outline-button">⌖ <span>Connect broker</span></button><button className="solid-button" onClick={() => { setSection("Trade"); setOrderPlaced(false); }}>＋ <span>New order</span></button></div></div>
          {section === "Markets" && <>
            <div className="chart-toolbar"><button className="symbol-select" onClick={() => setWatchlistOpen(!watchlistOpen)}><span className="coin btc">{symbol.icon}</span><b>{symbol.symbol}</b><span className="chevron">⌄</span></button><div className="toolbar-divider"/>{timeframes.map((item) => <button key={item} className={timeframe === item ? "time-button active" : "time-button"} onClick={() => setTimeframe(item)}>{item}</button>)}<div className="toolbar-divider"/><button className="indicator-button">⌁ <span>Indicators</span></button><button className="chart-icon-button" title="Chart layout">▦</button><button className="chart-icon-button" title="Take snapshot">⌗</button><span className="toolbar-spacer"/><span className="chart-live"><i/>DEMO</span></div>
            <div className="market-summary"><div><span className="instrument-name">{symbol.name} <span className="exchange-tag">· {symbol.group === "Crypto" ? "COINBASE" : "GLOBAL"}</span></span><strong>{symbol.price}</strong><span className={symbol.up ? "positive" : "negative"}>{symbol.change} <small>today</small></span></div><div className="ohlc"><span>O <b>85,742</b></span><span>H <b>86,104</b></span><span>L <b>85,518</b></span><span>C <b>85,890</b></span><span>Vol <b>1.24B</b></span></div></div>
            <section className="chart-panel"><div className="chart-labels"><span><i className="legend-candle"/> Candles</span><span><i className="legend-line"/> EMA 20</span><span className="chart-label-right">USD <span>⌄</span></span></div><div className="chart-stage"><aside className="drawing-toolbar">{chartTools.slice(0, 9).map((tool, index) => <button key={`${tool}-draw-${index}`} className={activeTool === tool ? "drawing-button chosen" : "drawing-button"} title={`Drawing tool ${index + 1}`} onClick={() => setActiveTool(activeTool === tool ? "" : tool)}>{tool}</button>)}<span className="draw-separator"/><button className="drawing-button" title="Remove drawings" onClick={() => setActiveTool("")}>⌫</button></aside><Chart symbol={symbol} timeframe={timeframe} drawing={activeTool} aiOnChart={aiOnChart}/></div><div className="chart-footer"><span>⌖ Crosshair</span><span>⤢ Auto</span><span className="chart-footer-spacer"/><span>1D</span><span>5D</span><span>1M</span><span>6M</span><span>1Y</span><span>ALL</span><span className="utc">17:24:08 UTC</span></div></section>
            <div className="lower-tabs"><button className="lower-tab active">Overview</button><button className="lower-tab">Ideas <span className="count">3</span></button><button className="lower-tab">Financials</button><button className="lower-tab">News <span className="count">5</span></button><span className="lower-tabs-right">Data delayed by up to 15 min</span></div>
            <div className="below-chart"><section className="watch-summary"><div className="section-title"><div><span className="small-label">YOUR WATCHLIST</span><h2>Market pulse</h2></div><button className="text-action" onClick={() => setWatchlistOpen(!watchlistOpen)}>View watchlist ↗</button></div><div className="pulse-row"><span>Fear & Greed</span><strong>68 <small>Greed</small></strong><div className="sentiment-track"><i/></div><span className="positive">+6 pts</span></div><div className="pulse-row"><span>BTC dominance</span><strong>58.4%</strong><span className="muted">+0.3% this week</span></div></section><section className="ai-takeaway"><div className="ai-heading"><span className="ai-spark">✳</span><span className="small-label">ZURI AI · CHART READ</span><span className="confidence">82% CONFIDENCE</span></div><h2>Momentum is building, but watch the $86.2k ceiling.</h2><p>Buyers reclaimed the intraday trend after a strong volume spike. A close above resistance would strengthen the bullish case; losing $85.4k could invalidate it.</p><div className="ai-foot"><span>Updated 2 min ago</span><button className="text-action" onClick={() => setAiExpanded(!aiExpanded)}>{aiExpanded ? "Hide analysis ↑" : "See full analysis →"}</button></div>{aiExpanded && <div className="ai-expanded">Scenario: bullish continuation above $86,200. Invalidation: sustained close below $85,400. This is an informational market read, not a recommendation.</div>}</section></div>
          </>}
          {section === "Dashboard" && <Dashboard setSection={setSection}/>}
          {section === "Trade" && <TradeView symbol={symbol} orderSide={orderSide} setOrderSide={setOrderSide} orderPlaced={orderPlaced} setOrderPlaced={setOrderPlaced}/>}
          {section === "History" && <HistoryView/>}
          {section === "Settings" && <SettingsView/>}
        </div>
        <aside className={watchlistOpen ? "right-rail" : "right-rail collapsed"}>
          <div className="rail-head"><div><h2>Watchlist</h2><span className="rail-count">{instruments.length} markets</span></div><button className="rail-action" title="Add symbol" onClick={() => document.getElementById("market-search")?.focus()}>＋</button><button className="rail-action" title="Collapse watchlist" onClick={() => setWatchlistOpen(false)}>⌄</button></div>
          {watchlistOpen && <><label className="search-box"><span>⌕</span><input id="market-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search markets"/><kbd>/</kbd></label><div className="watchlist-columns"><span>SYMBOL</span><span>LAST</span><span>24H</span></div><div className="watchlist-items">{filteredInstruments.map((item) => <button key={item.symbol} className={symbol.symbol === item.symbol ? "watch-row selected" : "watch-row"} onClick={() => { setSymbol(item); setSection("Markets"); }}><span className={`watch-icon ${item.group.toLowerCase()}`}>{item.icon}</span><span className="watch-symbol"><b>{item.symbol}</b><small>{item.group}</small></span><span className="watch-price">{item.price}</span><span className={item.up ? "watch-change positive" : "watch-change negative"}>{item.change}</span></button>)}{filteredInstruments.length === 0 && <div className="empty-search">No matching markets</div>}</div><div className="rail-section-heading"><span>SAMPLE AI BRIEF</span><span className="live-dot"/></div><section className="ai-news-card"><div className="ai-card-top"><span className="ai-spark">✳</span><span>SAMPLE FEED</span><span className="news-time">2m</span></div><h3>Bitcoin holds above $85K as ETF inflows return</h3><p>Spot ETF products recorded $420M in net inflows yesterday, their strongest session in two weeks.</p><div className="impact-row"><span>BTCUSD impact</span><span className="impact bullish">BULLISH <i>↗</i></span></div><button className="news-link" onClick={() => setAiOnChart(!aiOnChart)}>{aiOnChart ? "Added to chart ✓" : "Add context to chart +"}</button></section><div className="news-list-title"><span>SAMPLE HEADLINES</span><button className="text-action">All news →</button></div><div className="news-item"><span className="news-source">MARKET DESK <i>· 14m</i></span><p>Fed officials signal patience as inflation cools</p><span className="impact neutral">MACRO</span></div><div className="news-item"><span className="news-source">CRYPTO PULSE <i>· 38m</i></span><p>Ethereum staking queues hit a 3-month high</p><span className="impact bullish">ETHUSD ↗</span></div></>}
        </aside>
      </div>
      <footer className="statusbar"><span><i className="live-dot"/> All systems operational</span><span>Paper trading <b>ON</b></span><span>Prices in USD</span><span className="status-spacer"/><span>⌁ &nbsp;Help center</span></footer>
    </main>
  );
}

function Dashboard({ setSection }: { setSection: (section: Section) => void }) {
  return <div className="secondary-view"><div className="dashboard-greeting"><div><span className="small-label">FRIDAY, OCTOBER 02, 2026</span><h2>Good afternoon, Jordan.</h2><p>Here’s the signal behind your numbers today.</p></div><button className="solid-button" onClick={() => setSection("Trade")}>＋ <span>New order</span></button></div><div className="stat-grid"><Metric label="Net liquidation" value="$24,680.42" change="+$1,284.20 (5.49%)"/><Metric label="Today's P&L" value="+$284.60" change="+1.17% today"/><Metric label="Win rate" value="64.8%" change="Last 30 days"/><Metric label="Open positions" value="3" change="$8,420 deployed"/></div><div className="dashboard-columns"><section className="content-card performance-card"><div className="section-title"><div><span className="small-label">PORTFOLIO PERFORMANCE</span><h2>Account growth</h2></div><select aria-label="Performance period"><option>30 days</option><option>90 days</option><option>1 year</option></select></div><div className="performance-total">$24,680 <span>+5.49%</span></div><div className="performance-chart"><svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-label="Portfolio growth line"><defs><linearGradient id="performance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#38c49a" stopOpacity=".22"/><stop offset="1" stopColor="#38c49a" stopOpacity="0"/></linearGradient></defs><path d="M0 156 C45 151 54 132 92 140 S145 112 179 127 S236 90 265 106 S315 72 347 87 S395 69 425 78 S467 42 510 55 S551 38 582 48 S635 19 700 24 L700 190 L0 190Z" fill="url(#performance-fill)"/><path d="M0 156 C45 151 54 132 92 140 S145 112 179 127 S236 90 265 106 S315 72 347 87 S395 69 425 78 S467 42 510 55 S551 38 582 48 S635 19 700 24" fill="none" stroke="#39c99e" strokeWidth="2.5"/></svg></div><div className="performance-dates"><span>SEP 03</span><span>SEP 10</span><span>SEP 17</span><span>SEP 24</span><span>OCT 02</span></div></section><section className="content-card advice-card"><div className="ai-heading"><span className="ai-spark">✳</span><span className="small-label">ZURI · ACCOUNT COACH</span></div><h2>Protect your gains on high-volatility days.</h2><p>Your average position size is 28% larger than last month. On days your exposure exceeds $7,500, your drawdown has historically doubled.</p><div className="advice-stat"><span>Current exposure</span><b>$8,420 <i>Above your $7,500 threshold</i></b></div><button className="outline-button">Review open positions →</button><small>Based on your last 90 days · Not financial advice</small></section></div><section className="content-card positions-card"><div className="section-title"><div><span className="small-label">ACCOUNT</span><h2>Open positions</h2></div><button className="text-action" onClick={() => setSection("Trade")}>Trade →</button></div><PositionsTable/></section></div>;
}
function Metric({ label, value, change }: { label: string; value: string; change: string }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small className={change.startsWith("+") ? "positive" : "muted"}>{change}</small></div>; }
function TradeView({ symbol, orderSide, setOrderSide, orderPlaced, setOrderPlaced }: { symbol: Instrument; orderSide: "Buy" | "Sell"; setOrderSide: (side: "Buy" | "Sell") => void; orderPlaced: boolean; setOrderPlaced: (placed: boolean) => void }) {
  return <div className="secondary-view trade-view"><div className="trade-intro"><div><span className="small-label">ORDER TICKET</span><h2>Place an order</h2><p>Paper trading account · $24,680.42 available</p></div><span className="paper-tag">PAPER MODE</span></div><div className="trade-layout"><section className="content-card order-card"><div className="side-toggle"><button className={orderSide === "Buy" ? "buy active" : "buy"} onClick={() => setOrderSide("Buy")}>Buy / Long</button><button className={orderSide === "Sell" ? "sell active" : "sell"} onClick={() => setOrderSide("Sell")}>Sell / Short</button></div><label className="field-label">Symbol<select defaultValue={symbol.symbol}>{instruments.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.name}</option>)}</select></label><div className="field-row"><label className="field-label">Order type<select><option>Market</option><option>Limit</option><option>Stop</option><option>Stop limit</option></select></label><label className="field-label">Time in force<select><option>Good for day</option><option>Good till canceled</option></select></label></div><div className="field-row"><label className="field-label">Quantity<input defaultValue="0.025" inputMode="decimal"/></label><label className="field-label">Limit price (USD)<input defaultValue={symbol.price.replace(",", "")} inputMode="decimal"/></label></div><div className="order-estimate"><span>Estimated value</span><b>$2,147.25</b><span>Buying power after order</span><b>$22,533.17</b></div><button className={orderSide === "Buy" ? "submit-order buy-submit" : "submit-order sell-submit"} onClick={() => setOrderPlaced(true)}>{orderPlaced ? "Order submitted ✓" : `${orderSide} ${symbol.symbol}`}</button><small className="disclaimer">Paper order only. No real funds will be used.</small></section><section className="content-card trade-context"><div className="section-title"><div><span className="small-label">MARKET SNAPSHOT</span><h2>{symbol.symbol}</h2></div><span className="positive">{symbol.change}</span></div><strong className="snapshot-price">${symbol.price}</strong><div className="snapshot-row"><span>Bid</span><b>$85,884.00</b><span>Ask</span><b>$85,890.00</b></div><div className="snapshot-row"><span>24h high</span><b>$86,214.00</b><span>24h low</span><b>$84,902.00</b></div><div className="trade-ai-note"><span className="ai-spark">✳</span><div><b>Zuri risk check</b><p>This order is 8.7% of your net liquidation. Your typical position is 5.2%.</p></div></div></section></div><section className="content-card positions-card"><div className="section-title"><div><span className="small-label">PORTFOLIO</span><h2>Open positions</h2></div><span className="muted">3 positions</span></div><PositionsTable/></section></div>;
}
function PositionsTable() {
  const rows = [["BTCUSD", "Long", "$84,620.00", "$85,890.00", "+$126.80", "+1.50%"], ["ETHUSD", "Long", "$2,241.20", "$2,284.60", "+$86.80", "+1.94%"], ["SOLUSD", "Short", "$145.30", "$142.82", "+$49.60", "+1.71%"]];
  return <div className="table-scroll"><table><thead><tr><th>SYMBOL</th><th>SIDE</th><th>ENTRY</th><th>MARK</th><th>UNREALIZED P&L</th><th>RETURN</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><td><b>{row[0]}</b></td><td><span className={row[1] === "Long" ? "side-pill long" : "side-pill short"}>{row[1]}</span></td><td>{row[2]}</td><td>{row[3]}</td><td className="positive">{row[4]}</td><td className="positive">{row[5]}</td></tr>)}</tbody></table></div>;
}
function HistoryView() {
  const rows = [["BTCUSD", "Buy", "Market", "0.025 BTC", "$84,620.00", "Filled", "Oct 02, 14:32"], ["ETHUSD", "Buy", "Limit", "2.00 ETH", "$2,241.20", "Filled", "Oct 02, 12:18"], ["SOLUSD", "Sell", "Limit", "20 SOL", "$145.30", "Filled", "Oct 01, 16:04"], ["BTCUSD", "Sell", "Stop", "0.018 BTC", "$83,900.00", "Canceled", "Sep 30, 09:42"]];
  return <div className="secondary-view"><div className="section-title history-title"><div><span className="small-label">PAPER ACCOUNT · ALL ACTIVITY</span><h2>Order history</h2></div><button className="outline-button">⇩ <span>Export CSV</span></button></div><div className="content-card history-card"><div className="history-filters"><button className="filter-chip active">All activity</button><button className="filter-chip">Filled</button><button className="filter-chip">Canceled</button><select aria-label="History period"><option>Last 30 days</option><option>Last 90 days</option><option>All time</option></select></div><div className="table-scroll"><table><thead><tr><th>SYMBOL</th><th>SIDE</th><th>TYPE</th><th>QUANTITY</th><th>AVG. PRICE</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row[0]}-${row[6]}`}><td><b>{row[0]}</b></td><td className={row[1] === "Buy" ? "positive" : "negative"}>{row[1]}</td><td>{row[2]}</td><td>{row[3]}</td><td>{row[4]}</td><td><span className={row[5] === "Filled" ? "status-pill filled" : "status-pill canceled"}>{row[5]}</span></td><td>{row[6]}</td></tr>)}</tbody></table></div></div><div className="history-summary"><span>4 orders in the last 30 days</span><span>Total realized P&L <b className="positive">+$482.20</b></span></div></div>;
}
function SettingsView() {
  return <div className="secondary-view settings-view"><div className="section-title"><div><span className="small-label">PREFERENCES</span><h2>Workspace settings</h2></div><button className="solid-button">✓ <span>Save changes</span></button></div><div className="settings-layout"><nav className="settings-nav"><button className="active">General</button><button>Appearance</button><button>Notifications</button><button>Trading</button><button>Security</button></nav><div className="content-card settings-card"><div className="settings-section"><span className="small-label">REGIONAL</span><h3>Language & region</h3><div className="setting-row"><div><b>Language</b><small>Language used across your workspace</small></div><select><option>English (US)</option><option>English (UK)</option><option>Español</option></select></div><div className="setting-row"><div><b>Display currency</b><small>Currency used for balances and charts</small></div><select><option>USD · U.S. Dollar</option><option>EUR · Euro</option><option>GBP · Pound Sterling</option></select></div><div className="setting-row"><div><b>Time zone</b><small>Times shown in charts and order history</small></div><select><option>New York (UTC−04:00)</option><option>UTC</option><option>London (UTC+01:00)</option></select></div></div><div className="settings-section"><span className="small-label">TRADING</span><h3>Order preferences</h3><div className="setting-row"><div><b>Confirm orders before submitting</b><small>Review order details before they are placed</small></div><input type="checkbox" defaultChecked/></div><div className="setting-row"><div><b>Paper trading mode</b><small>Simulate orders with virtual funds</small></div><input type="checkbox" defaultChecked/></div></div></div></div></div>;
}

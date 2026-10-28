"use client";
import { formatDateTime } from "./time-zone";

import { useEffect, useState } from "react";
import { backendUrl, formatMoney, type LinkedAccountState } from "./linked-account";
import { SnapshotGallery } from "./trade-snapshots";

type Fill = { id: string; symbol: string; side: string; quantity: number; price: number | null; time: string | null };
type Trip = { id: string; symbol: string; side: string; quantity: number; entry_price: number | null; exit_price: number | null; opened_at: string | null; closed_at: string | null; realized_pl: number | null };
type HistoryData = { fills: Fill[]; round_trips: Trip[] };
type Tab = "closed" | "orders" | "open";
type Period = "Today" | "Last week" | "Last month" | "Last 3 months" | "Last 6 months" | "All time";

const periodDays: Record<Period, number | null> = { Today: 1, "Last week": 7, "Last month": 30, "Last 3 months": 90, "Last 6 months": 180, "All time": null };
const when = (iso: string | null) => (iso ? formatDateTime(iso) : "—");

export function HistoryView({ linked, token, refreshKey }: { linked: LinkedAccountState; token: string; refreshKey: number }) {
  const [tab, setTab] = useState<Tab>("closed");
  const [period, setPeriod] = useState<Period>("Last month");
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState("");
  const connected = Boolean(linked.data);
  const currency = linked.data?.account?.currency ?? "USD";

  useEffect(() => {
    if (!token || !connected) return;
    let cancelled = false;
    fetch(`${backendUrl}/api/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not load history.");
        return body as HistoryData;
      })
      .then((body) => { if (!cancelled) { setData(body); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load history."); });
    return () => { cancelled = true; };
  }, [token, connected, linked.data?.broker, refreshKey]);

  const [now, setNow] = useState(() => Date.now());
  const cutoff = periodDays[period] === null ? 0 : now - (periodDays[period] as number) * 86_400_000;
  const inPeriod = (iso: string | null) => cutoff === 0 || (iso !== null && Date.parse(iso) >= cutoff);
  const trips = (data?.round_trips ?? []).filter((t) => inPeriod(t.closed_at));
  const fills = (data?.fills ?? []).filter((f) => inPeriod(f.time)).sort((a, b) => Date.parse(b.time ?? "") - Date.parse(a.time ?? ""));
  const positions = linked.data?.positions ?? [];
  const total = tab === "open" ? positions.reduce((s, p) => s + (p.unrealized_pl ?? 0), 0) : trips.reduce((s, t) => s + (t.realized_pl ?? 0), 0);

  const exportCsv = () => {
    const rows = tab === "orders"
      ? [["time", "symbol", "side", "quantity", "price"], ...fills.map((f) => [f.time ?? "", f.symbol, f.side, f.quantity, f.price ?? ""])]
      : [["opened", "closed", "symbol", "side", "quantity", "entry", "exit", "realized_pl"], ...trips.map((t) => [t.opened_at ?? "", t.closed_at ?? "", t.symbol, t.side, t.quantity, t.entry_price ?? "", t.exit_price ?? "", t.realized_pl ?? ""])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `zuri-${tab}-history.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const plClass = (value: number | null) => (value === null ? "" : value >= 0 ? "positive" : "negative");
  const plText = (value: number | null) => (value === null ? "—" : `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value), currency)}`);

  return (
    <div className="secondary-view">
      <div className="section-title history-title" data-zuri-target="history-log">
        <button className="outline-button" type="button" onClick={exportCsv} disabled={tab === "open" || !data}>⇩ <span>Export CSV</span></button>
      </div>

      {!connected && <p className="auth-message">{linked.status === "loading" ? "Loading your broker account…" : "Link a broker in Settings → Broker to see your trade history."}</p>}
      {error && <p className="auth-message" role="alert">{error}</p>}

      {connected && <div className="content-card history-card">
        <div className="history-toolbar">
          <div className="history-tabs" aria-label="History tabs" data-zuri-target="history-tabs">
            {([["closed", "Closed trades"], ["orders", "Orders"], ["open", "Open positions"]] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" className={tab === key ? "history-tab active" : "history-tab"} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          {tab !== "open" && <div className="history-controls"><label className="history-filter"><span>Period</span><select value={period} onChange={(event) => { setNow(Date.now()); setPeriod(event.target.value as Period); }}>{(Object.keys(periodDays) as Period[]).map((option) => <option key={option}>{option}</option>)}</select></label></div>}
        </div>
        <div className="table-scroll">
          {tab === "closed" && <table><thead><tr><th>Symbol</th><th>Side</th><th>Quantity</th><th>Entry</th><th>Exit</th><th>Opened</th><th>Closed</th><th>P&amp;L</th></tr></thead><tbody>
            {trips.map((t) => <tr key={`${t.id}-${t.closed_at}`}><td><b>{t.symbol}</b></td><td><span className={t.side === "long" ? "side-pill long" : "side-pill short"}>{t.side === "long" ? "Long" : "Short"}</span></td><td>{t.quantity}</td><td>{t.entry_price ?? "—"}</td><td>{t.exit_price ?? "—"}</td><td>{when(t.opened_at)}</td><td>{when(t.closed_at)}</td><td className={plClass(t.realized_pl)}>{plText(t.realized_pl)}</td></tr>)}
          </tbody></table>}
          {tab === "orders" && <table><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Quantity</th><th>Price</th></tr></thead><tbody>
            {fills.map((f) => <tr key={f.id}><td>{when(f.time)}</td><td><b>{f.symbol}</b></td><td><span className={f.side === "buy" ? "side-pill long" : "side-pill short"}>{f.side === "buy" ? "Buy" : "Sell"}</span></td><td>{f.quantity}</td><td>{f.price ?? "—"}</td></tr>)}
          </tbody></table>}
          {tab === "open" && <table><thead><tr><th>Symbol</th><th>Side</th><th>Quantity</th><th>Avg entry</th><th>Current</th><th>Unrealized P&amp;L</th></tr></thead><tbody>
            {positions.map((p) => <tr key={p.symbol}><td><b>{p.symbol}</b></td><td><span className={p.side === "short" ? "side-pill short" : "side-pill long"}>{p.side === "short" ? "Short" : "Long"}</span></td><td>{p.quantity ?? "—"}</td><td>{formatMoney(p.avg_entry_price, currency)}</td><td>{formatMoney(p.current_price, currency)}</td><td className={plClass(p.unrealized_pl)}>{plText(p.unrealized_pl)}</td></tr>)}
          </tbody></table>}
          {!data && !error && tab !== "open" && <p className="auth-message">Loading your trades from the broker…</p>}
          {data && ((tab === "closed" && trips.length === 0) || (tab === "orders" && fills.length === 0)) && <p className="auth-message">No trades in this period yet.</p>}
          {tab === "open" && positions.length === 0 && <p className="auth-message">No open positions.</p>}
        </div>
      </div>}

      {connected && <div className="history-summary">
        <span>{tab === "closed" ? trips.length : tab === "orders" ? fills.length : positions.length} records{tab !== "open" ? ` · ${period}` : ""}</span>
        {tab !== "orders" && <span>Total {tab === "open" ? "floating" : "realized"} P&amp;L <b className={total >= 0 ? "positive" : "negative"}>{plText(total)}</b></span>}
        <small>Closed-trade P&amp;L is estimated from filled orders for Alpaca and Tradier.</small>
      </div>}

      <div data-zuri-target="history-snapshots"><SnapshotGallery token={token} refreshKey={refreshKey} /></div>
    </div>
  );
}

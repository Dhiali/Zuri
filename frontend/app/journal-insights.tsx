"use client";

import { useEffect, useRef, useState } from "react";
import { backendUrl } from "./linked-account";

type Stats = {
  symbols_of_interest: number;
  symbols_traded: number;
  interest_to_trade_rate_pct: number | null;
  median_hours_interest_to_first_trade: number | null;
  entry_trades: number;
  exits: number;
  trades_with_journal_note_pct: number | null;
  trades_with_written_plan_and_stop_pct: number | null;
  trades_without_stop_loss: number;
  max_trades_in_one_day: number;
  avg_position_pct_of_equity: number | null;
  max_position_pct_of_equity: number | null;
  most_traded_symbol: string | null;
  most_traded_symbol_share_pct: number | null;
  win_rate_pct: number | null;
  closed_trades_with_pl: number;
  total_realized_pl_estimate: number | null;
};

type TimelineItem = { at: string; kind: string; symbol: string | null; side?: string; action?: string; quantity?: number };

const kindLabel: Record<string, string> = {
  watchlist_add: "Added to watchlist",
  watchlist_remove: "Removed from watchlist",
  symbol_viewed: "Opened the chart",
  order_placed: "Placed an order",
  position_detected: "Position detected",
};

const tzOffset = () => -new Date().getTimezoneOffset();

// Fire-and-forget: tracking must never interrupt the user.
export function trackJourneyEvent(token: string, kind: "watchlist_add" | "watchlist_remove" | "symbol_viewed", symbol: string) {
  if (!token) return;
  void fetch(`${backendUrl}/api/journal/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, symbol }),
  }).catch(() => undefined);
}

export async function draftJournalNote(token: string, entryId: string) {
  const response = await fetch(`${backendUrl}/api/journal/entries/${entryId}/ai-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Zuri could not draft this note.");
  return String(body.note);
}

function Report({ text }: { text: string }) {
  return (
    <div className="journal-report">
      {text.split("\n").map((line, index) => {
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return <p key={index}>{parts.map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</p>;
      })}
    </div>
  );
}

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

export function JournalInsights({ token, refreshKey, onEntriesChanged }: { token: string; refreshKey: number; onEntriesChanged: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const synced = useRef(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}` };
    const load = () => fetch(`${backendUrl}/api/journal/insights?tz_offset_minutes=${tzOffset()}`, { headers })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Insights are unavailable."))))
      .then((body: { stats: Stats; timeline: TimelineItem[] }) => {
        if (cancelled) return;
        setStats(body.stats);
        setTimeline(body.timeline);
        setError("");
      });
    const run = synced.current
      ? load()
      : fetch(`${backendUrl}/api/journal/sync`, { method: "POST", headers })
        .then((response) => (response.ok ? response.json() : { created: 0 }))
        .then((body: { created: number }) => {
          synced.current = true;
          if (body.created > 0 && !cancelled) onEntriesChanged();
        })
        .catch(() => { synced.current = true; })
        .then(load);
    run.catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Insights are unavailable.");
    });
    return () => { cancelled = true; };
  }, [token, refreshKey, onEntriesChanged]);

  async function analyse() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${backendUrl}/api/journal/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tz_offset_minutes: tzOffset() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Zuri could not analyse your journal.");
      setReport(String(body.report));
      setStats(body.stats);
    } catch (analyseError) {
      setError(analyseError instanceof Error ? analyseError.message : "Zuri could not analyse your journal.");
    } finally {
      setBusy(false);
    }
  }

  const tiles: [string, string][] = stats ? [
    ["Interest → trade", `${stats.symbols_traded} of ${stats.symbols_of_interest} pairs`],
    ["Time from interest to first trade", stats.median_hours_interest_to_first_trade === null ? "—" : `${stats.median_hours_interest_to_first_trade} h (median)`],
    ["Trades", `${stats.entry_trades} in · ${stats.exits} out`],
    ["Trades with a written plan + stop", pct(stats.trades_with_written_plan_and_stop_pct)],
    ["Trades without a stop-loss", String(stats.trades_without_stop_loss)],
    ["Avg / max position size", `${pct(stats.avg_position_pct_of_equity)} / ${pct(stats.max_position_pct_of_equity)} of equity`],
    ["Win rate (closed)", stats.closed_trades_with_pl ? `${pct(stats.win_rate_pct)} of ${stats.closed_trades_with_pl}` : "—"],
    ["Busiest day", `${stats.max_trades_in_one_day} trades`],
  ] : [];

  return (
    <section className="content-card journal-insights">
      <div className="section-title">
        <div><span className="small-label">ZURI · LEAK FINDER &amp; STRATEGY ANALYSER</span><h2>Your trading journey, tracked automatically</h2></div>
        <button className="solid-button" onClick={() => void analyse()} disabled={busy}>{busy ? "Analysing…" : "Analyse my journey"}</button>
      </div>
      <p className="muted">Zuri records every pair you watch, every chart you open and every trade you place (including ones opened outside Zuri), then analyses the pattern. Nothing to fill in.</p>
      {error && <p className="auth-message" role="alert">{error}</p>}
      {stats && <div className="journal-stat-grid">{tiles.map(([label, value]) => <div key={label} className="journal-stat"><span>{label}</span><strong>{value}</strong></div>)}</div>}
      {report && <Report text={report} />}
      {timeline.length > 0 && (
        <details className="journal-timeline">
          <summary>Journey timeline ({timeline.length} latest events)</summary>
          <ol>{[...timeline].reverse().map((item, index) => <li key={`${item.at}-${index}`}><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time> {kindLabel[item.kind] ?? item.kind}{item.symbol ? ` · ${item.symbol}` : ""}{item.side ? ` · ${item.side}` : ""}{item.quantity ? ` ×${item.quantity}` : ""}</li>)}</ol>
        </details>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, LineStyle, createChart, createSeriesMarkers, type UTCTimestamp } from "lightweight-charts";
import { backendUrl } from "./linked-account";
import { grabScreenFrame, startScreenShare, stopScreenShare, useScreenShareActive } from "./screen-capture";

type Candle = { t: string; o: number; h: number; l: number; c: number };
type Annotation = { kind: string; index: number | null; price: number | null; text: string };
type Markers = { price?: number | null; side?: string; kind?: string; stop_loss?: number | null; take_profit?: number | null; realized_pl?: number | null };

export type TradeSnapshot = {
  id: string;
  symbol: string;
  kind: "entry" | "exit" | "detected";
  side: string | null;
  candles: Candle[];
  markers: Markers;
  annotations: Annotation[];
  analysis: string;
  journal_entry_id: string | null;
  has_screenshot: boolean;
  created_at: string;
};

const kindColor: Record<string, string> = {
  support: "#2fbf71", resistance: "#e5534b", entry: "#4f8cff", exit: "#e0a43a", risk: "#e5534b", note: "#9aa4b5",
};
const kindName = { entry: "Entry", exit: "Exit", detected: "Position found" } as const;

const toTime = (iso: string) => Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Request failed.");
  return body as T;
}

export function useSnapshots(token: string, refreshKey: number) {
  const [snapshots, setSnapshots] = useState<TradeSnapshot[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ snapshots: TradeSnapshot[] }>(token, "/api/snapshots?limit=30")
      .then((data) => { if (!cancelled) { setSnapshots(data.snapshots); setStatus("ready"); setError(""); } })
      .catch((e) => { if (!cancelled) { setStatus("error"); setError(e instanceof Error ? e.message : "Could not load snapshots."); } });
    return () => { cancelled = true; };
  }, [token, refreshKey, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { snapshots, status, error, reload };
}

// Called right after an order. Grabs the real screen immediately (if the user is sharing), then attaches it
// to the snapshot once the server has created it.
export function captureScreenForTrade(token: string, symbol: string, onDone: () => void) {
  const frame = grabScreenFrame();
  const upper = symbol.toUpperCase();
  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    try {
      const { snapshots } = await api<{ snapshots: TradeSnapshot[] }>(token, "/api/snapshots?limit=5");
      const fresh = snapshots.find((s) => s.symbol === upper && Date.now() - Date.parse(s.created_at) < 5 * 60_000 && !s.has_screenshot);
      if (fresh && frame) {
        await api(token, `/api/snapshots/${fresh.id}/screenshot`, { method: "POST", body: JSON.stringify({ image: frame }) });
        onDone();
        return;
      }
      if (!fresh && attempts < 5) { setTimeout(poll, 4000); return; }
      onDone();
    } catch {
      if (attempts < 5) setTimeout(poll, 4000);
    }
  };
  setTimeout(poll, 4000);
}

function SnapshotChart({ snapshot, reveal, onReady }: { snapshot: TradeSnapshot; reveal: boolean; onReady?: (shot: () => HTMLCanvasElement) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const data = useMemo(() => {
    const seen = new Set<number>();
    return snapshot.candles
      .map((c) => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c }))
      .filter((c) => Number.isFinite(c.time) && !seen.has(c.time) && seen.add(c.time))
      .sort((a, b) => a.time - b.time);
  }, [snapshot.candles]);

  useEffect(() => {
    if (!host.current || data.length === 0) return;
    const chart = createChart(host.current, {
      height: 300,
      layout: { background: { type: ColorType.Solid, color: "#10151f" }, textColor: "#9aa4b5" },
      grid: { vertLines: { color: "#1b2331" }, horzLines: { color: "#1b2331" } },
      timeScale: { timeVisible: true, borderColor: "#263043" },
      rightPriceScale: { borderColor: "#263043" },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: "#2fbf71", downColor: "#e5534b", wickUpColor: "#2fbf71", wickDownColor: "#e5534b", borderVisible: false });
    series.setData(data);
    const line = (price: number | null | undefined, color: string, title: string, style = LineStyle.Dashed) => {
      if (typeof price === "number" && Number.isFinite(price)) series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, title, axisLabelVisible: true });
    };
    const m = snapshot.markers;
    line(m.price, kindColor.entry, kindName[snapshot.kind], LineStyle.Solid);
    line(m.stop_loss, kindColor.risk, "Stop");
    line(m.take_profit, kindColor.support, "Target");
    const markers = [];
    const last = data[data.length - 1];
    markers.push({ time: last.time, position: snapshot.side === "sell" ? ("aboveBar" as const) : ("belowBar" as const), color: kindColor[snapshot.kind === "exit" ? "exit" : "entry"], shape: snapshot.side === "sell" ? ("arrowDown" as const) : ("arrowUp" as const), text: kindName[snapshot.kind] });
    if (reveal) {
      snapshot.annotations.forEach((a, i) => {
        if (a.price !== null && a.index === null) line(a.price, kindColor[a.kind] ?? kindColor.note, `${i + 1}`, LineStyle.Dotted);
        if (a.index !== null && snapshot.candles[a.index]) {
          const time = toTime(snapshot.candles[a.index].t);
          if (data.some((d) => d.time === time) && !(time === last.time && a.kind === "entry")) {
            markers.push({ time, position: "aboveBar" as const, color: kindColor[a.kind] ?? kindColor.note, shape: "circle" as const, text: `${i + 1}` });
          }
        }
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);
    chart.timeScale().fitContent();
    onReady?.(() => chart.takeScreenshot());
    const resize = new ResizeObserver(() => chart.applyOptions({ width: host.current?.clientWidth ?? 600 }));
    resize.observe(host.current);
    return () => { resize.disconnect(); chart.remove(); };
  }, [data, snapshot, reveal, onReady]);

  if (data.length === 0) return <p className="auth-message">No candle data for this snapshot.</p>;
  return <div className="snapshot-chart" ref={host} />;
}

function SnapshotCard({ snapshot, token, onChanged }: { snapshot: TradeSnapshot; token: string; onChanged: () => void }) {
  const [practice, setPractice] = useState(false);
  const [revealed, setRevealed] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("");
  const shooter = useRef<(() => HTMLCanvasElement) | null>(null);
  const sharing = useScreenShareActive();
  const onReady = useCallback((fn: () => HTMLCanvasElement) => { shooter.current = fn; }, []);
  const reveal = !practice || revealed;
  const pl = snapshot.markers.realized_pl;

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setMessage("");
    try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(""); }
  };
  const download = () => {
    shooter.current?.().toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${snapshot.symbol}-${snapshot.kind}-${snapshot.created_at.slice(0, 10)}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  };

  return (
    <article className="content-card snapshot-card">
      <div className="journal-entry-heading">
        <div><span className="small-label">{kindName[snapshot.kind].toUpperCase()} SNAPSHOT · 15m</span><h3>{snapshot.symbol} {snapshot.side && <span className={`side-pill ${snapshot.side === "sell" ? "short" : "long"}`}>{snapshot.side === "sell" ? "Sell" : "Buy"}</span>}</h3></div>
        <div className="journal-entry-actions"><time dateTime={snapshot.created_at}>{new Date(snapshot.created_at).toLocaleString()}</time><button className="text-action" onClick={() => void run("delete", async () => { await api(token, `/api/snapshots/${snapshot.id}`, { method: "DELETE" }); onChanged(); })}>Delete</button></div>
      </div>
      <SnapshotChart snapshot={snapshot} reveal={reveal} onReady={onReady} />
      {reveal && typeof pl === "number" && <p className={pl >= 0 ? "positive" : "negative"}>Estimated result: {pl >= 0 ? "+" : ""}{pl.toFixed(2)}</p>}
      {practice && !revealed && <div className="snapshot-practice"><p>Practice: look at the chart. Where would you place the stop? Is this a good {snapshot.kind === "exit" ? "exit" : "entry"}?</p><button className="solid-button" onClick={() => setRevealed(true)}>Reveal Zuri&apos;s annotations</button></div>}
      {reveal && snapshot.analysis && <p className="snapshot-analysis"><b>Zuri:</b> {snapshot.analysis}</p>}
      {reveal && snapshot.annotations.length > 0 && <ol className="snapshot-notes">{snapshot.annotations.map((a, i) => <li key={i}><span style={{ color: kindColor[a.kind] ?? kindColor.note }}>{a.kind}</span> {a.text}</li>)}</ol>}
      {!snapshot.analysis && <p className="auth-message">Zuri has not annotated this chart yet.</p>}
      {screen && <img className="snapshot-screen" src={screen} alt={`Screen capture when ${snapshot.symbol} was traded`} />}
      {message && <p className="auth-message" role="alert">{message}</p>}
      <div className="snapshot-actions">
        <button className="outline-button" disabled={busy !== ""} onClick={() => void run("annotate", async () => { await api(token, `/api/snapshots/${snapshot.id}/annotate`, { method: "POST" }); onChanged(); })}>{busy === "annotate" ? "Annotating…" : snapshot.analysis ? "Re-annotate" : "Annotate with Zuri"}</button>
        <button className="outline-button" onClick={() => { setPractice((value) => !value); setRevealed(practice); }}>{practice ? "Exit practice mode" : "Practice mode"}</button>
        <button className="outline-button" onClick={download}>Download PNG</button>
        {snapshot.has_screenshot && !screen && <button className="outline-button" disabled={busy !== ""} onClick={() => void run("screen", async () => { const r = await api<{ image: string }>(token, `/api/snapshots/${snapshot.id}/screenshot`); setScreen(r.image); })}>View my screen capture</button>}
        {sharing && !snapshot.has_screenshot && <button className="outline-button" disabled={busy !== ""} onClick={() => void run("attach", async () => { const frame = grabScreenFrame(); if (!frame) throw new Error("Could not read the shared screen."); await api(token, `/api/snapshots/${snapshot.id}/screenshot`, { method: "POST", body: JSON.stringify({ image: frame }) }); onChanged(); })}>Attach screen capture now</button>}
      </div>
    </article>
  );
}

export function ScreenShareControl() {
  const sharing = useScreenShareActive();
  const [error, setError] = useState("");
  return (
    <div className="screen-share-control">
      <div>
        <b>Capture my real TradingView screen</b>
        <p>{sharing ? "Sharing is on. Zuri grabs your screen the moment you place an order here." : "Optional. Your browser will ask permission and shows a sharing indicator while it is on. Zuri only keeps a still image when you trade."}</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
      </div>
      <button className={sharing ? "outline-button" : "solid-button"} onClick={() => { setError(""); if (sharing) stopScreenShare(); else startScreenShare().catch((e) => setError(e instanceof Error && e.name === "NotAllowedError" ? "Screen sharing was not allowed." : "Screen capture could not start.")); }}>{sharing ? "Stop sharing" : "Turn on screen capture"}</button>
    </div>
  );
}

export function SnapshotGallery({ token, refreshKey, entryId, showControls = true }: { token: string; refreshKey: number; entryId?: string; showControls?: boolean }) {
  const { snapshots, status, error, reload } = useSnapshots(token, refreshKey);
  const visible = entryId ? snapshots.filter((s) => s.journal_entry_id === entryId) : snapshots;
  if (entryId && visible.length === 0) return null;
  return (
    <section className="snapshot-gallery">
      {!entryId && <div className="section-title"><div><span className="small-label">AI-ANNOTATED CHART SNAPSHOTS</span><h2>Trade snapshots</h2></div></div>}
      {showControls && <ScreenShareControl />}
      {status === "loading" && <p className="auth-message">Loading snapshots…</p>}
      {status === "error" && <p className="auth-message" role="alert">{error}</p>}
      {status === "ready" && visible.length === 0 && <div className="content-card journal-empty"><span className="small-label">NO SNAPSHOTS YET</span><p>When you place or close a trade, Zuri saves the chart around that moment and annotates it here. Stock charts are supported now; other markets show when your broker provides candles.</p></div>}
      {visible.map((snapshot) => <SnapshotCard key={snapshot.id} snapshot={snapshot} token={token} onChanged={reload} />)}
    </section>
  );
}

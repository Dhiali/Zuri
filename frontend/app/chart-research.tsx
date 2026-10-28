"use client";
import { formatDateTime } from "./time-zone";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backendUrl } from "./linked-account";
import { loadResearchState, saveResearchState, type ResearchKind } from "./user-data";

type Condition = "breakout" | "moving_average_cross" | "rsi_level";
type Direction = "up" | "down" | "above" | "below" | "bullish" | "bearish";
type ScannerRule = {
  name: string;
  condition: Condition;
  direction: Direction;
  lookback: number;
  fast_period: number;
  slow_period: number;
  threshold: number;
  symbol: string;
  timeframe: string;
};
type Scanner = ScannerRule & {
  id: string;
  active: boolean;
  lastSignalAt: string | null;
  lastScannedAt: string | null;
  lastAlert: string;
  status: string;
};
type Bar = { t: string; o: number; h: number; l: number; c: number };
type Signal = { time: string; direction: "long" | "short"; returnPct: number | null };
type HistoryResponse = { bars: Bar[]; truncated: boolean; broker: string; detail?: string };
type BacktestResult = {
  broker: string;
  bars: number;
  truncated: boolean;
  holdBars: number;
  signalCount: number;
  signals: Signal[];
  averageReturn: number;
  winRate: number;
};

type BacktestRun = {
  id: string;
  ranAt: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  label: string;
  rule: ScannerRule;
  holdBars: number;
  result: BacktestResult;
};

const MAX_SAVED_RUNS = 20;
const MAX_SCANNERS = 5;

function readStored<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeStored(key: string, items: unknown[]) {
  try { window.localStorage.setItem(key, JSON.stringify(items)); } catch { /* storage full or unavailable: keep working in memory */ }
}

const historyLookbackDays: Record<string, number> = {
  "1m": 2,
  "5m": 5,
  "15m": 14,
  "1h": 45,
  "4h": 90,
  "1D": 400,
  "1W": 1800,
};
const timeframeMilliseconds: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
  "1W": 7 * 24 * 60 * 60_000,
};

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function initialStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return dateInputValue(date);
}

function meanClose(bars: Bar[], end: number, period: number) {
  const start = end - period + 1;
  if (start < 0) return null;
  return bars.slice(start, end + 1).reduce((sum, bar) => sum + bar.c, 0) / period;
}

function rsi(bars: Bar[], end: number, period = 14) {
  if (end < period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = end - period + 1; index <= end; index += 1) {
    const change = bars[index].c - bars[index - 1].c;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function signalDirection(rule: ScannerRule): "long" | "short" {
  if (rule.condition === "breakout") return rule.direction === "up" ? "long" : "short";
  if (rule.condition === "moving_average_cross") return rule.direction === "bullish" ? "long" : "short";
  return rule.direction === "above" ? "long" : "short";
}

function matchesAt(rule: ScannerRule, bars: Bar[], index: number) {
  if (rule.condition === "breakout") {
    const previous = bars.slice(Math.max(0, index - rule.lookback), index);
    if (previous.length < rule.lookback) return false;
    return rule.direction === "up"
      ? bars[index].c > Math.max(...previous.map((bar) => bar.h))
      : bars[index].c < Math.min(...previous.map((bar) => bar.l));
  }
  if (rule.condition === "moving_average_cross") {
    const fastNow = meanClose(bars, index, rule.fast_period);
    const slowNow = meanClose(bars, index, rule.slow_period);
    const fastBefore = meanClose(bars, index - 1, rule.fast_period);
    const slowBefore = meanClose(bars, index - 1, rule.slow_period);
    if (fastNow === null || slowNow === null || fastBefore === null || slowBefore === null) return false;
    return rule.direction === "bullish"
      ? fastBefore <= slowBefore && fastNow > slowNow
      : fastBefore >= slowBefore && fastNow < slowNow;
  }
  const previousRsi = rsi(bars, index - 1);
  const currentRsi = rsi(bars, index);
  if (previousRsi === null || currentRsi === null) return false;
  return rule.direction === "above"
    ? previousRsi < rule.threshold && currentRsi >= rule.threshold
    : previousRsi > rule.threshold && currentRsi <= rule.threshold;
}

function evaluateRule(rule: ScannerRule, bars: Bar[], holdBars: number): Signal[] {
  const signals: Signal[] = [];
  const firstIndex = rule.condition === "breakout"
    ? rule.lookback
    : rule.condition === "moving_average_cross"
      ? rule.slow_period
      : 15;
  for (let index = firstIndex; index < bars.length; index += 1) {
    if (!matchesAt(rule, bars, index)) continue;
    const direction = signalDirection(rule);
    const entry = bars[index + 1]?.o;
    const exit = bars[index + holdBars]?.c;
    const returnPct = entry && exit
      ? ((exit - entry) / entry) * (direction === "long" ? 100 : -100)
      : null;
    signals.push({ time: bars[index].t, direction, returnPct });
  }
  return signals;
}

function completedBars(bars: Bar[], timeframe: string, now = new Date()) {
  const duration = timeframeMilliseconds[timeframe];
  if (!duration) return bars;
  return bars.filter((bar) => Date.parse(bar.t) + duration <= now.getTime());
}

async function getHistory(
  token: string,
  broker: string,
  symbol: string,
  timeframe: string,
  start: Date,
  end: Date,
) {
  const params = new URLSearchParams({
    broker,
    symbol,
    timeframe,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const response = await fetch(`${backendUrl}/api/market-history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({})) as HistoryResponse;
  if (!response.ok) {
    throw new Error(typeof body.detail === "string" ? body.detail : `Historical data request failed (${response.status}).`);
  }
  if (!Array.isArray(body.bars)) throw new Error("The broker returned an invalid history response.");
  return body;
}

export function ChartResearch({
  symbol,
  timeframe,
  broker,
  token,
  userId,
  eventContext,
  onClearEventContext,
  visible,
}: {
  symbol: string;
  timeframe: string;
  broker: string;
  token: string;
  userId: string;
  eventContext: { title: string; published_at: string | null } | null;
  onClearEventContext: () => void;
  visible: boolean;
}) {
  const [scannerPrompt, setScannerPrompt] = useState("");
  const [scannerDraft, setScannerDraft] = useState<ScannerRule | null>(null);
  const [scannerState, setScannerState] = useState(() => ({ owner: userId, items: readStored<Scanner>(`zuri.scanners.${userId}`) }));
  const scanners = useMemo(
    () => scannerState.owner === userId ? scannerState.items : readStored<Scanner>(`zuri.scanners.${userId}`),
    [scannerState, userId],
  );
  const scannersRef = useRef(scanners);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerAlert, setScannerAlert] = useState("");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(() => dateInputValue(new Date()));
  const [researchSymbol, setResearchSymbol] = useState<string | null>(null);
  const selectedResearchSymbol = researchSymbol ?? symbol;
  const [eventLabel, setEventLabel] = useState("");
  const selectedEventLabel = eventContext?.title ?? eventLabel;
  const [rule, setRule] = useState<ScannerRule>({
    name: "Breakout review",
    condition: "breakout",
    direction: "up",
    lookback: 20,
    fast_period: 10,
    slow_period: 30,
    threshold: 70,
    symbol,
    timeframe,
  });
  const [holdBars, setHoldBars] = useState(5);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [runsState, setRunsState] = useState(() => ({ owner: userId, items: readStored<BacktestRun>(`zuri.backtests.${userId}`) }));
  const runs = useMemo(
    () => runsState.owner === userId ? runsState.items : readStored<BacktestRun>(`zuri.backtests.${userId}`),
    [runsState, userId],
  );
  const [viewedRun, setViewedRun] = useState<BacktestRun | null>(null);
  const syncedRef = useRef<Record<ResearchKind, boolean>>({ scanners: false, backtests: false });
  const pushTimers = useRef<Partial<Record<ResearchKind, number>>>({});
  const pushRemote = useCallback((kind: ResearchKind, items: unknown[]) => {
    if (!syncedRef.current[kind] || !userId) return;
    window.clearTimeout(pushTimers.current[kind]);
    pushTimers.current[kind] = window.setTimeout(() => { void saveResearchState(userId, kind, items).catch(() => undefined); }, 1200);
  }, [userId]);

  useEffect(() => {
    scannersRef.current = scanners;
    writeStored(`zuri.scanners.${userId}`, scanners);
    pushRemote("scanners", scanners);
  }, [scanners, userId, pushRemote]);

  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);

  // The account is the source of truth. Anything already in this browser is uploaded once, the first time the account has nothing saved.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    syncedRef.current = { scanners: false, backtests: false };
    void (async () => {
      for (const kind of ["scanners", "backtests"] as ResearchKind[]) {
        try {
          const remote = await loadResearchState(userId, kind);
          if (cancelled) return;
          if (remote === null) {
            const local = kind === "scanners" ? scannersRef.current : runsRef.current;
            if (local.length > 0) await saveResearchState(userId, kind, local);
          } else if (kind === "scanners") {
            setScannerState({ owner: userId, items: remote as Scanner[] });
          } else {
            setRunsState({ owner: userId, items: remote as BacktestRun[] });
            writeStored(`zuri.backtests.${userId}`, remote);
          }
          syncedRef.current[kind] = true;
        } catch {
          // The table may not exist yet or the network is down: keep working from this browser's copy.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const saveRun = (run: BacktestRun) => {
    const next = [run, ...runs].slice(0, MAX_SAVED_RUNS);
    setRunsState({ owner: userId, items: next });
    writeStored(`zuri.backtests.${userId}`, next);
    pushRemote("backtests", next);
  };
  const removeRun = (id: string) => {
    const next = runs.filter((run) => run.id !== id);
    setRunsState({ owner: userId, items: next });
    writeStored(`zuri.backtests.${userId}`, next);
    pushRemote("backtests", next);
    if (viewedRun?.id === id) setViewedRun(null);
  };
  const clearRuns = () => {
    setRunsState({ owner: userId, items: [] });
    writeStored(`zuri.backtests.${userId}`, []);
    pushRemote("backtests", []);
    setViewedRun(null);
  };
  const reuseRun = (run: BacktestRun) => {
    setResearchSymbol(run.symbol);
    setStartDate(run.startDate);
    setEndDate(run.endDate);
    setRule(run.rule);
    setHoldBars(run.holdBars);
    setEventLabel(run.label);
    onClearEventContext();
    document.getElementById("backtest-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const updateScanners = useCallback((update: Scanner[] | ((current: Scanner[]) => Scanner[])) => {
    setScannerState((current) => {
      const currentItems = current.owner === userId ? current.items : readStored<Scanner>(`zuri.scanners.${userId}`);
      return { owner: userId, items: typeof update === "function" ? update(currentItems) : update };
    });
  }, [userId]);

  useEffect(() => {
    if (!token || !broker || !userId) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      try {
        await Promise.all(scannersRef.current.filter((scanner) => scanner.active).map(async (scanner) => {
          try {
            const end = new Date();
            const start = new Date(end.getTime() - (historyLookbackDays[scanner.timeframe] ?? 45) * 24 * 60 * 60_000);
            const history = await getHistory(token, broker, scanner.symbol, scanner.timeframe, start, end);
            const bars = completedBars(history.bars, scanner.timeframe);
            if (bars.length < 3) throw new Error("The broker has not returned enough candles to evaluate this scanner.");
            const latestBarTime = bars[bars.length - 1].t;
            const freshSignal = scanner.lastScannedAt
              ? evaluateRule(scanner, bars, 1)
                .filter((signal) => Date.parse(signal.time) > Date.parse(scanner.lastScannedAt ?? ""))
                .at(-1)
              : undefined;
            if (cancelled) return;
            if (!scannersRef.current.some((item) => item.id === scanner.id && item.active)) return;
            const direction = freshSignal?.direction === "long" ? "upward" : "downward";
            if (freshSignal) {
              setScannerAlert(`${scanner.name} · ${scanner.symbol} · ${direction} ${scanner.condition.replaceAll("_", " ")} condition`);
            }
            updateScanners((current) => current.map((item) => {
              if (item.id !== scanner.id) return item;
              if (freshSignal) {
                return {
                  ...item,
                  lastSignalAt: freshSignal.time,
                  lastScannedAt: latestBarTime,
                  lastAlert: `${formatDateTime(freshSignal.time)} · ${direction} ${item.condition.replaceAll("_", " ")} condition`,
                  status: "Monitoring",
                };
              }
              return { ...item, lastScannedAt: latestBarTime, status: "Monitoring" };
            }));
          } catch (error) {
            if (cancelled) return;
            updateScanners((current) => current.map((item) => item.id === scanner.id
              ? { ...item, status: error instanceof Error ? error.message : "Unable to check scanner history." }
              : item));
          }
        }));
      } finally {
        polling = false;
      }
    };
    const interval = window.setInterval(() => void poll(), 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [token, broker, userId, updateScanners]);

  const configureScanner = async () => {
    if (!scannerPrompt.trim() || !token) return;
    setScannerBusy(true);
    setScannerError("");
    setScannerDraft(null);
    try {
      const response = await fetch(`${backendUrl}/api/scanners/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: scannerPrompt, symbol, timeframe }),
      });
      const body = await response.json().catch(() => ({})) as { scanner?: ScannerRule; detail?: string };
      if (!response.ok) throw new Error(body.detail ?? `Scanner setup failed (${response.status}).`);
      if (!body.scanner) throw new Error("Zuri returned an invalid scanner setup.");
      setScannerDraft(body.scanner);
    } catch (error) {
      setScannerError(error instanceof Error ? error.message : "Unable to set up the scanner.");
    } finally {
      setScannerBusy(false);
    }
  };

  const activateScanner = () => {
    if (!scannerDraft) return;
    if (scannersRef.current.length >= MAX_SCANNERS) {
      setScannerError("You can keep up to five scanners. Remove one before adding another.");
      return;
    }
    const scanner: Scanner = {
      ...scannerDraft,
      id: crypto.randomUUID(),
      active: true,
      lastSignalAt: null,
      lastScannedAt: null,
      lastAlert: "",
      status: "Starting",
    };
    updateScanners((current) => [scanner, ...current]);
    setScannerDraft(null);
    setScannerPrompt("");
    setScannerError("");
  };

  const runBacktest = async () => {
    if (!token || !broker || !startDate || !endDate) return;
    setBacktestBusy(true);
    setBacktestError("");
    setBacktestResult(null);
    try {
      const start = new Date(`${startDate}T00:00:00`);
      const chosenEnd = new Date(`${endDate}T23:59:59`);
      const end = chosenEnd > new Date() ? new Date() : chosenEnd;
      if (start >= end) throw new Error("Choose a start date before the end date.");
      if (!Number.isInteger(holdBars) || holdBars < 1 || holdBars > 100) throw new Error("Hold candles must be a whole number from 1 to 100.");
      if (rule.condition === "breakout" && (!Number.isInteger(rule.lookback) || rule.lookback < 2 || rule.lookback > 200)) {
        throw new Error("Breakout lookback must be a whole number from 2 to 200.");
      }
      if (rule.condition === "moving_average_cross" && (
        !Number.isInteger(rule.fast_period) || !Number.isInteger(rule.slow_period)
        || rule.fast_period < 2 || rule.fast_period >= rule.slow_period || rule.slow_period > 200
      )) throw new Error("Choose whole-number moving-average periods where the fast period is smaller than the slow period.");
      if (rule.condition === "rsi_level" && (!Number.isFinite(rule.threshold) || rule.threshold < 5 || rule.threshold > 95)) {
        throw new Error("RSI threshold must be from 5 to 95.");
      }
      const selectedSymbol = selectedResearchSymbol.trim().toUpperCase();
      const history = await getHistory(token, broker, selectedSymbol, timeframe, start, end);
      const bars = completedBars(history.bars, timeframe, end);
      const configuredRule = { ...rule, symbol: selectedSymbol, timeframe };
      const signals = evaluateRule(configuredRule, bars, holdBars);
      const completed = signals.filter((signal) => signal.returnPct !== null);
      if (bars.length < 20) throw new Error("The broker returned too few completed candles for a meaningful review.");
      const averageReturn = completed.length
        ? completed.reduce((total, signal) => total + (signal.returnPct ?? 0), 0) / completed.length
        : 0;
      const wins = completed.filter((signal) => (signal.returnPct ?? 0) > 0).length;
      const result: BacktestResult = {
        broker: history.broker,
        bars: bars.length,
        truncated: history.truncated,
        holdBars,
        signalCount: completed.length,
        signals: completed.slice(-30).reverse(),
        averageReturn,
        winRate: completed.length ? (wins / completed.length) * 100 : 0,
      };
      setBacktestResult(result);
      setViewedRun(null);
      saveRun({
        id: crypto.randomUUID(),
        ranAt: new Date().toISOString(),
        symbol: selectedSymbol,
        timeframe,
        startDate,
        endDate,
        label: selectedEventLabel.trim(),
        rule: configuredRule,
        holdBars,
        result,
      });
    } catch (error) {
      setBacktestError(error instanceof Error ? error.message : "Unable to load historical broker data.");
    } finally {
      setBacktestBusy(false);
    }
  };

  const updateRule = (changes: Partial<ScannerRule>) => setRule((current) => ({ ...current, ...changes }));
  const ruleDirection = rule.condition === "breakout" ? ["up", "down"]
    : rule.condition === "moving_average_cross" ? ["bullish", "bearish"]
      : ["above", "below"];

  return (
    <div className={visible ? "chart-research" : "chart-research dormant"}>
      {scannerAlert && !visible && <div className="scanner-toast" role="status"><span>✦ Scanner alert · {scannerAlert}</span><button type="button" aria-label="Dismiss scanner alert" onClick={() => setScannerAlert("")}>×</button></div>}
      <div hidden={!visible}>
      <section className="content-card scanner-card" aria-labelledby="scanner-title" data-zuri-target="chart-scanners">
        <div className="chart-research-heading">
          <div><span className="small-label">AI SCANNERS · RUN WHILE ZURI IS OPEN</span><h2 id="scanner-title">Build a scanner with Zuri</h2><p>Describe a technical condition. Review the rule before activating it; scanners only monitor broker candles while this app is open.</p></div>
          <span className="chart-research-icon" aria-hidden="true">⌕</span>
        </div>
        {!broker && <p className="chart-research-notice">Connect a supported broker in Settings → Broker to configure scanners and load historical candles.</p>}
        <div className="scanner-builder">
          <label className="field-label">What should Zuri look for?<textarea value={scannerPrompt} onChange={(event) => setScannerPrompt(event.target.value)} maxLength={500} rows={2} placeholder={`Example: alert me if ${symbol} closes above its 20-candle high`} /></label>
          <button className="solid-button" type="button" disabled={!broker || !scannerPrompt.trim() || scannerBusy} onClick={() => void configureScanner()}>{scannerBusy ? "Drafting scanner…" : "✦ Draft with Zuri"}</button>
        </div>
        {scannerError && <p className="auth-error" role="alert">{scannerError}</p>}
        {scannerDraft && (
          <div className="scanner-draft">
            <div><b>{scannerDraft.name}</b><span>{scannerDraft.symbol} · {scannerDraft.timeframe} · {scannerDraft.condition.replaceAll("_", " ")} · {scannerDraft.direction}</span></div>
            {scannerDraft.condition === "breakout" && <small>Lookback: {scannerDraft.lookback} candles</small>}
            {scannerDraft.condition === "moving_average_cross" && <small>Moving averages: {scannerDraft.fast_period} / {scannerDraft.slow_period}</small>}
            {scannerDraft.condition === "rsi_level" && <small>RSI crosses {scannerDraft.direction} {scannerDraft.threshold}</small>}
            <button className="outline-button" type="button" disabled={scanners.length >= 5} onClick={activateScanner}>Activate scanner</button>
          </div>
        )}
        {scanners.length > 0 && <div className="active-scanners"><div className="section-title"><div><span className="small-label">SAVED TO YOUR ACCOUNT · CHECKED WHILE ZURI IS OPEN</span><h3>Scanners</h3></div><span className="muted">{scanners.filter((scanner) => scanner.active).length} / 5 active</span></div>
          {scanners.map((scanner) => <div className="active-scanner" key={scanner.id}>
            <div><b>{scanner.name}</b><span>{scanner.symbol} · {scanner.timeframe} · {scanner.condition.replaceAll("_", " ")}</span>{scanner.lastAlert && <small className="scanner-alert">Latest signal · {scanner.lastAlert}</small>}<small className={scanner.status === "Monitoring" ? "scanner-status" : "scanner-status warning"}>{scanner.active ? scanner.status : "Paused"}</small></div>
            <div><button className="text-action" type="button" onClick={() => updateScanners((current) => current.map((item) => item.id === scanner.id ? { ...item, active: !item.active, status: item.active ? "Paused" : "Starting" } : item))}>{scanner.active ? "Pause" : "Resume"}</button><button className="text-action" type="button" onClick={() => updateScanners((current) => current.filter((item) => item.id !== scanner.id))}>Remove</button></div>
          </div>)}
        </div>}
      </section>

      <section className="content-card backtest-card" aria-labelledby="backtest-title" data-zuri-target="chart-backtest">
        <div className="chart-research-heading">
          <div><span className="small-label">BROKER CANDLES · HISTORICAL SIGNAL REVIEW</span><h2 id="backtest-title">Backtest a setup or event</h2><p>Use actual candles from your connected broker for this pair and date range.</p></div>
          <span className="chart-research-icon" aria-hidden="true">↶</span>
        </div>
        {eventContext && <p className="chart-research-notice">Selected story{eventContext.published_at ? ` · published ${formatDateTime(eventContext.published_at)}` : ""}. Set a date range that includes the event window; news is not automatically matched to candles. <button className="text-action" type="button" onClick={() => { setEventLabel(""); onClearEventContext(); }}>Clear</button></p>}
        <div className="backtest-fields">
          <label className="field-label">Pair / symbol<input value={selectedResearchSymbol} maxLength={20} onChange={(event) => setResearchSymbol(event.target.value.toUpperCase())} /></label>
          <label className="field-label">Event or context label<input value={selectedEventLabel} maxLength={500} onChange={(event) => { setEventLabel(event.target.value); onClearEventContext(); }} placeholder="Optional · e.g. CPI week" /></label>
          <label className="field-label">From<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field-label">To<input type="date" value={endDate} min={startDate || undefined} max={dateInputValue(new Date())} onChange={(event) => setEndDate(event.target.value)} /></label>
          <label className="field-label">Signal<select value={rule.condition} onChange={(event) => {
            const condition = event.target.value as Condition;
            updateRule({ condition, direction: condition === "breakout" ? "up" : condition === "moving_average_cross" ? "bullish" : "above" });
          }}><option value="breakout">Price breakout</option><option value="moving_average_cross">Moving-average cross</option><option value="rsi_level">RSI level cross</option></select></label>
          <label className="field-label">Direction<select value={rule.direction} onChange={(event) => updateRule({ direction: event.target.value as Direction })}>{ruleDirection.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label>
          {rule.condition === "breakout" && <label className="field-label">Lookback candles<input type="number" min={2} max={200} value={rule.lookback} onChange={(event) => updateRule({ lookback: Number(event.target.value) })} /></label>}
          {rule.condition === "moving_average_cross" && <><label className="field-label">Fast average<input type="number" min={2} max={100} value={rule.fast_period} onChange={(event) => updateRule({ fast_period: Number(event.target.value) })} /></label><label className="field-label">Slow average<input type="number" min={3} max={200} value={rule.slow_period} onChange={(event) => updateRule({ slow_period: Number(event.target.value) })} /></label></>}
          {rule.condition === "rsi_level" && <label className="field-label">RSI threshold<input type="number" min={5} max={95} value={rule.threshold} onChange={(event) => updateRule({ threshold: Number(event.target.value) })} /></label>}
          <label className="field-label">Hold for candles<input type="number" min={1} max={100} value={holdBars} onChange={(event) => setHoldBars(Number(event.target.value))} /></label>
        </div>
        <div className="backtest-actions"><p>Event labels are notes only; Zuri does not automatically match news events to historical candles.</p><button className="solid-button" type="button" disabled={!broker || backtestBusy || !selectedResearchSymbol.trim() || !startDate || !endDate} onClick={() => void runBacktest()}>{backtestBusy ? "Loading broker candles…" : "Run historical review"}</button></div>
        {!broker && <p className="chart-research-notice">No broker is linked. Connect one to request its historical candle data.</p>}
        {backtestError && <p className="auth-error" role="alert">{backtestError}</p>}
        {backtestResult && <div className="backtest-results" aria-live="polite">
          <div className="backtest-metrics"><div><span>Broker candles</span><b>{backtestResult.bars.toLocaleString()}</b></div><div><span>Completed signals</span><b>{backtestResult.signalCount.toLocaleString()}</b></div><div><span>Average {backtestResult.holdBars}-bar return</span><b className={backtestResult.averageReturn >= 0 ? "positive" : "negative"}>{backtestResult.averageReturn >= 0 ? "+" : ""}{backtestResult.averageReturn.toFixed(2)}%</b></div><div><span>Positive outcomes</span><b>{backtestResult.winRate.toFixed(1)}%</b></div></div>
          <p className="backtest-source">{backtestResult.broker} data · {selectedResearchSymbol} · {timeframe}{selectedEventLabel.trim() ? ` · ${selectedEventLabel.trim()}` : ""}{backtestResult.truncated ? " · provider candle limit reached" : ""}</p>
          {backtestResult.signalCount > backtestResult.signals.length && <p className="backtest-source">Showing the most recent {backtestResult.signals.length} of {backtestResult.signalCount} completed signals.</p>}
          {backtestResult.signals.length > 0 && <div className="table-scroll"><table><thead><tr><th>Signal time</th><th>Direction</th><th>Next-candle entry / fixed-hold result</th></tr></thead><tbody>{backtestResult.signals.map((signal) => <tr key={`${signal.time}-${signal.direction}`}><td>{formatDateTime(signal.time)}</td><td>{signal.direction}</td><td className={(signal.returnPct ?? 0) >= 0 ? "positive" : "negative"}>{(signal.returnPct ?? 0) >= 0 ? "+" : ""}{(signal.returnPct ?? 0).toFixed(2)}%</td></tr>)}</tbody></table></div>}
          {backtestResult.signalCount === 0 && <p className="muted">No completed signals matched this rule in the selected history.</p>}
        </div>}
        <p className="backtest-disclaimer">Historical signals are not a simulation of fills and exclude fees, slippage, spreads, and event-time matching. Past results do not predict future performance or guarantee profit.</p>
      </section>

      <section className="content-card backtest-card" aria-labelledby="backtest-history-title" data-zuri-target="chart-backtest-history">
        <div className="section-title"><div><span className="small-label">SAVED TO YOUR ACCOUNT · LAST {MAX_SAVED_RUNS} RUNS</span><h2 id="backtest-history-title">Backtest history</h2></div>{runs.length > 0 && <button className="text-action" type="button" onClick={() => { if (window.confirm("Delete all saved backtest runs?")) clearRuns(); }}>Clear all</button>}</div>
        {runs.length === 0 ? <p className="muted">Every historical review you run is saved here so you can compare setups later.</p> : <div className="table-scroll"><table><thead><tr><th>Run</th><th>Setup</th><th>Range</th><th>Signals</th><th>Avg return</th><th>Positive</th><th /></tr></thead><tbody>{runs.map((run) => <tr key={run.id}>
          <td>{formatDateTime(run.ranAt)}</td>
          <td>{run.symbol} · {run.timeframe} · {run.rule.condition.replaceAll("_", " ")} {run.rule.direction}{run.label ? ` · ${run.label}` : ""}</td>
          <td>{run.startDate} → {run.endDate}</td>
          <td>{run.result.signalCount}</td>
          <td className={run.result.averageReturn >= 0 ? "positive" : "negative"}>{run.result.averageReturn >= 0 ? "+" : ""}{run.result.averageReturn.toFixed(2)}%</td>
          <td>{run.result.winRate.toFixed(1)}%</td>
          <td><button className="text-action" type="button" onClick={() => setViewedRun(viewedRun?.id === run.id ? null : run)}>{viewedRun?.id === run.id ? "Hide" : "View"}</button> <button className="text-action" type="button" onClick={() => reuseRun(run)}>Run again</button> <button className="text-action" type="button" onClick={() => removeRun(run.id)}>Delete</button></td>
        </tr>)}</tbody></table></div>}
        {viewedRun && <div className="backtest-results">
          <p className="backtest-source">{viewedRun.result.broker} data · {viewedRun.symbol} · {viewedRun.timeframe} · hold {viewedRun.holdBars} candles · {viewedRun.result.bars.toLocaleString()} candles reviewed</p>
          {viewedRun.result.signals.length > 0 ? <div className="table-scroll"><table><thead><tr><th>Signal time</th><th>Direction</th><th>Fixed-hold result</th></tr></thead><tbody>{viewedRun.result.signals.map((signal) => <tr key={`${signal.time}-${signal.direction}`}><td>{formatDateTime(signal.time)}</td><td>{signal.direction}</td><td className={(signal.returnPct ?? 0) >= 0 ? "positive" : "negative"}>{(signal.returnPct ?? 0) >= 0 ? "+" : ""}{(signal.returnPct ?? 0).toFixed(2)}%</td></tr>)}</tbody></table></div> : <p className="muted">That run found no completed signals.</p>}
        </div>}
      </section>
      </div>
    </div>
  );
}

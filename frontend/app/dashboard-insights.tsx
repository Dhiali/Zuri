"use client";

import { useEffect, useState } from "react";
import { backendUrl } from "./linked-account";

type GroupStats = { trades: number; wins: number; win_rate_pct: number | null; total_pl: number };
type Comparison = { groups: Record<string, GroupStats>; verdict: "reliable" | "possibly_chance" | "insufficient_data"; best: string | null; worst: string | null };
type Summary = { trades: number; win_rate_pct: number | null; total_pl: number };
type Suggestion = { id: string; title: string; why: string; steps: string[]; topics: string[] };
type Resource = { topic: string; title: string; provider: string; url: string };
type Course = { title: string; provider: string; url: string; kind: string; why?: string };
type Learning = { courses: Course[]; videos: Course[]; based_on: { markets: string[]; experience: string | null } };
type Coaching =
  | { status: "no_broker" | "unsupported"; learning?: Learning }
  | {
      status: "ok";
      learning?: Learning;
      trades_analyzed: number;
      weekly: { this_week: Summary; last_week: Summary; daily_last7: { date: string; weekday: string; trades: number; pl: number }[]; weekday: Comparison; session: Comparison };
      profile: { style: string | null; win_rate_pct: number | null; payoff_ratio: number | null; profit_factor: number | null; expectancy: number | null; avg_win: number | null; avg_loss: number | null; max_consecutive_losses: number; top_symbol: string | null; top_symbol_share_pct: number | null; long_share_pct: number | null; trades: number };
      headlines: { tone: string; text: string }[];
      suggestions: Suggestion[];
      resources: Resource[];
    };

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Request failed.");
  return body as T;
}

const signed = (value: number) => `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
const tzOffset = () => -new Date().getTimezoneOffset();

function DayBars({ days }: { days: { weekday: string; trades: number; pl: number }[] }) {
  const max = Math.max(1, ...days.map((d) => Math.abs(d.pl)));
  return (
    <div className="day-bars" role="img" aria-label="Profit and loss for each of the last seven days">
      {days.map((d, i) => (
        <div key={i} className="day-bar">
          <div className="day-bar-track"><i className={d.pl >= 0 ? "up" : "down"} style={{ height: `${Math.max(d.trades ? 6 : 0, (Math.abs(d.pl) / max) * 100)}%` }} /></div>
          <small>{d.weekday.slice(0, 3)}</small>
          <small className={d.pl > 0 ? "positive" : d.pl < 0 ? "negative" : "muted"}>{d.trades ? signed(d.pl) : "–"}</small>
        </div>
      ))}
    </div>
  );
}

function LearningSection({ learning, children, suggestionBasis }: { learning?: Learning; children?: React.ReactNode; suggestionBasis?: string }) {
  const hasLearning = !!learning && (learning.courses.length > 0 || learning.videos.length > 0);
  if (!hasLearning && !children) return null;
  const basis = learning ? [learning.based_on.experience, learning.based_on.markets.length ? learning.based_on.markets.join(", ") : null].filter(Boolean).join(" · ") : "";
  return (
    <section className="content-card coach-card" data-zuri-target="dash-learn">
      <div className="section-title"><div><span className="small-label">{suggestionBasis ?? "LEARN · CHOSEN FOR YOU"}{basis ? ` · ${basis.toUpperCase()}` : ""}</span><h2>Strategies and free learning</h2></div></div>
      {children}
      {learning && hasLearning && <>
        {children && <span className="small-label">VIDEOS AND FREE COURSES</span>}
        <ul className="resource-list">
          {learning.courses.map((c) => <li key={c.url}><a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a><small>{c.provider} · free course{c.why ? ` · ${c.why}` : ""} · opens in a new tab</small></li>)}
          {learning.videos.map((v) => <li key={v.url}><a href={v.url} target="_blank" rel="noopener noreferrer">{v.title}</a><small>YouTube videos · opens in a new tab</small></li>)}
        </ul>
      </>}
    </section>
  );
}

export function CoachingPanel({ token, refreshKey }: { token: string; refreshKey: number }) {
  const [data, setData] = useState<Coaching | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<Coaching>(token, `/api/dashboard/coaching?tz_offset_minutes=${tzOffset()}`)
      .then((body) => { if (!cancelled) { setData(body); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your coaching."); });
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  async function writeNote() {
    setNoteBusy(true);
    setNoteError("");
    try { setNote((await api<{ note: string }>(token, "/api/dashboard/coach-note", { method: "POST", body: JSON.stringify({ tz_offset_minutes: tzOffset() }) })).note); }
    catch (e) { setNoteError(e instanceof Error ? e.message : "Zuri could not write the review."); }
    finally { setNoteBusy(false); }
  }

  if (error) return <section className="content-card"><p className="auth-message" role="alert">{error}</p></section>;
  if (!data) return <section className="content-card"><p className="auth-message">Zuri is reviewing your trades…</p></section>;
  if (data.status !== "ok") return <>
    <section className="content-card coach-card" data-zuri-target="dash-weekly"><span className="small-label">ZURI COACHING</span><h2>Your weekly breakdown and strategy review</h2><p className="muted">{data.status === "no_broker" ? "Link a broker in Settings to unlock your weekly activity breakdown and personalised insights from your real trades." : "Coaching is not available for this broker yet."}</p></section>
    <LearningSection learning={data.learning} />
  </>;

  const { weekly, profile } = data;
  return (
    <>
      <section className="content-card coach-card" data-zuri-target="dash-weekly">
        <div className="section-title"><div><span className="small-label">YOUR WEEK · {data.trades_analyzed} CLOSED TRADES ANALYSED</span><h2>Weekly breakdown</h2></div></div>
        {data.trades_analyzed === 0 ? <p className="muted">No closed trades yet. Once you complete a trade, Zuri starts finding your patterns.</p> : <>
          <div className="stat-grid coach-stats">
            <div className="metric-card"><span>This week</span><strong>{weekly.this_week.trades} trades</strong><small className={weekly.this_week.total_pl >= 0 ? "positive" : "negative"}>{signed(weekly.this_week.total_pl)} · {weekly.this_week.win_rate_pct ?? "–"}% wins</small></div>
            <div className="metric-card"><span>Last week</span><strong>{weekly.last_week.trades} trades</strong><small className="muted">{weekly.last_week.trades ? `${signed(weekly.last_week.total_pl)} · ${weekly.last_week.win_rate_pct}% wins` : "No trades"}</small></div>
            <div className="metric-card"><span>Win rate · payoff</span><strong>{profile.win_rate_pct ?? "–"}% · {profile.payoff_ratio ?? "–"}:1</strong><small className="muted">Avg win ÷ avg loss</small></div>
            <div className="metric-card"><span>Expectancy per trade</span><strong>{profile.expectancy !== null ? signed(profile.expectancy) : "–"}</strong><small className="muted">{profile.style ?? "Style appears after 10 trades"}</small></div>
          </div>
          <DayBars days={weekly.daily_last7} />
          <ul className="coach-headlines">{data.headlines.map((h, i) => <li key={i} className={`tone-${h.tone}`}>{h.text}</li>)}</ul>
          <div className="coach-note">
            {note ? <p><b>Zuri&apos;s review:</b> {note}</p> : <button className="outline-button" disabled={noteBusy || data.trades_analyzed < 3} onClick={() => void writeNote()}>{noteBusy ? "Zuri is writing…" : "Ask Zuri for my weekly review"}</button>}
            {noteError && <p className="auth-message" role="alert">{noteError}</p>}
            <small className="disclaimer">Patterns are only called out when there are enough trades for them to be statistically meaningful. P&amp;L is estimated from your broker&apos;s filled orders. Educational only, not financial advice.</small>
          </div>
        </>}
      </section>

      <LearningSection learning={data.learning} suggestionBasis="BASED ON YOUR TRADING HISTORY">
        <div className="suggestion-list">
          {data.suggestions.map((s) => (
            <article key={s.id} className="suggestion">
              <h3>{s.title}</h3>
              <p>{s.why}</p>
              <ol>{s.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </article>
          ))}
        </div>
      </LearningSection>
    </>
  );
}

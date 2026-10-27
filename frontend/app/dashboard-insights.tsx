"use client";
import { formatDateTime } from "./time-zone";

import { useCallback, useEffect, useState } from "react";
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
      suggested_tags: string[];
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

function LearningSection({ learning }: { learning?: Learning }) {
  if (!learning || (!learning.courses.length && !learning.videos.length)) return null;
  const { markets, experience } = learning.based_on;
  const basis = [experience, markets.length ? markets.join(", ") : null].filter(Boolean).join(" · ");
  return (
    <section className="content-card coach-card" data-zuri-target="dash-learn">
      <div className="section-title"><div><span className="small-label">LEARN · CHOSEN FOR YOU{basis ? ` · ${basis.toUpperCase()}` : ""}</span><h2>Strategy videos and free courses</h2></div></div>
      <ul className="resource-list">
        {learning.courses.map((c) => <li key={c.url}><a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a><small>{c.provider} · free course{c.why ? ` · ${c.why}` : ""} · opens in a new tab</small></li>)}
        {learning.videos.map((v) => <li key={v.url}><a href={v.url} target="_blank" rel="noopener noreferrer">{v.title}</a><small>YouTube videos · opens in a new tab</small></li>)}
      </ul>
    </section>
  );
}

export function CoachingPanel({ token, refreshKey, onTags }: { token: string; refreshKey: number; onTags?: (tags: string[]) => void }) {
  const [data, setData] = useState<Coaching | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<Coaching>(token, `/api/dashboard/coaching?tz_offset_minutes=${tzOffset()}`)
      .then((body) => { if (!cancelled) { setData(body); setError(""); if (body.status === "ok") onTags?.(body.suggested_tags); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your coaching."); });
    return () => { cancelled = true; };
  }, [token, refreshKey, onTags]);

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

      <section className="content-card coach-card">
        <div className="section-title"><div><span className="small-label">BASED ON YOUR TRADING HISTORY</span><h2>Strategies to try</h2></div></div>
        <div className="suggestion-list">
          {data.suggestions.map((s) => (
            <article key={s.id} className="suggestion">
              <h3>{s.title}</h3>
              <p>{s.why}</p>
              <ol>{s.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </article>
          ))}
        </div>
      </section>
      <LearningSection learning={data.learning} />
    </>
  );
}

type CommunityData = {
  available_strategies: string[];
  profile: { handle: string; strategies: string[]; bio: string } | null;
  traders: { handle: string; strategies: string[]; shared: string[]; bio: string }[];
  posts: { id: string; handle: string; strategy: string; body: string; created_at: string; mine: boolean; replies: { id: string; handle: string; body: string; created_at: string; mine: boolean }[] }[];
};

export function CommunityPanel({ token, suggestedTags }: { token: string; suggestedTags: string[] }) {
  const [data, setData] = useState<CommunityData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftTag, setDraftTag] = useState("");
  const [replyFor, setReplyFor] = useState("");
  const [replyText, setReplyText] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<CommunityData>(token, `/api/community${filter ? `?strategy=${encodeURIComponent(filter)}` : ""}`)
      .then((body) => { if (!cancelled) { setData(body); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the community."); });
    return () => { cancelled = true; };
  }, [token, filter, tick]);

  const act = async (work: () => Promise<unknown>, done?: () => void) => {
    setMessage("");
    try { await work(); done?.(); reload(); } catch (e) { setMessage(e instanceof Error ? e.message : "Something went wrong."); }
  };

  if (error) return <section className="content-card"><p className="auth-message" role="alert">{error}</p></section>;
  if (!data) return <section className="content-card"><p className="auth-message">Loading the community…</p></section>;

  const joining = !data.profile || editing;
  if (joining) {
    const preset = tags.length ? tags : (data.profile?.strategies ?? suggestedTags.filter((t) => data.available_strategies.includes(t)));
    return (
      <section className="content-card community-card">
        <div className="section-title"><div><span className="small-label">ZURI COMMUNITY · OPT-IN</span><h2>{data.profile ? "Edit your community profile" : "Meet traders who use your strategies"}</h2></div></div>
        <p className="muted">Pick a nickname and the strategies you use. You only appear under a nickname: your name, email, balances and trades are never shared.</p>
        <label className="field-label">Nickname (3-20 letters, numbers, underscore)<input value={handle || data.profile?.handle || ""} maxLength={20} onChange={(e) => setHandle(e.target.value)} /></label>
        <label className="field-label">Short bio (optional)<input value={bio || data.profile?.bio || ""} maxLength={160} onChange={(e) => setBio(e.target.value)} /></label>
        <div className="tag-picker" role="group" aria-label="Your strategies">{data.available_strategies.map((tag) => <button type="button" key={tag} className={preset.includes(tag) ? "tag active" : "tag"} onClick={() => setTags(preset.includes(tag) ? preset.filter((t) => t !== tag) : [...preset, tag].slice(0, 5))}>{tag}</button>)}</div>
        {suggestedTags.length > 0 && <small className="muted">Zuri noticed you trade like a {suggestedTags[0].toLowerCase()} trader.</small>}
        {message && <p className="auth-error" role="alert">{message}</p>}
        <div className="snapshot-actions">
          <button className="solid-button" disabled={preset.length === 0} onClick={() => void act(() => api(token, "/api/community/profile", { method: "PUT", body: JSON.stringify({ handle: (handle || data.profile?.handle || "").trim(), strategies: preset, bio: (bio || data.profile?.bio || "").trim() }) }), () => { setEditing(false); setTags([]); setHandle(""); setBio(""); })}>{data.profile ? "Save" : "Join the community"}</button>
          {data.profile && <button className="outline-button" onClick={() => setEditing(false)}>Cancel</button>}
          {data.profile && <button className="text-action" onClick={() => { if (window.confirm("Leave the community? Your nickname and all your posts will be deleted.")) void act(() => api(token, "/api/community/profile", { method: "DELETE" }), () => setEditing(false)); }}>Leave community</button>}
        </div>
      </section>
    );
  }

  const profile = data.profile!;
  const toggleFilterTag = (tag: string) => setFilter((current) => (current === tag ? "" : tag));
  return (
    <section className="content-card community-card">
      <div className="section-title"><div><span className="small-label">ZURI COMMUNITY · @{profile.handle}</span><h2>Traders like you</h2></div><button className="text-action" onClick={() => setEditing(true)}>Edit profile</button></div>
      <div className="tag-picker" role="group" aria-label="Filter by strategy">{profile.strategies.map((tag) => <button key={tag} type="button" className={filter === tag ? "tag active" : "tag"} onClick={() => toggleFilterTag(tag)}>{tag}</button>)}</div>
      {data.traders.length > 0 && <div className="trader-row">{data.traders.map((t) => <div key={t.handle} className="trader-chip" title={t.bio}><b>@{t.handle}</b><small>{t.shared.join(" · ")}</small></div>)}</div>}
      {data.traders.length === 0 && <p className="muted">You are among the first with these strategies. Start a conversation below.</p>}
      <form className="trade-convo-form" onSubmit={(e) => { e.preventDefault(); void act(() => api(token, "/api/community/posts", { method: "POST", body: JSON.stringify({ body: draft, strategy: draftTag || filter || profile.strategies[0] }) }), () => setDraft("")); }}>
        <select value={draftTag || filter || profile.strategies[0]} onChange={(e) => setDraftTag(e.target.value)} aria-label="Strategy for this post">{profile.strategies.map((t) => <option key={t}>{t}</option>)}</select>
        <input value={draft} maxLength={600} onChange={(e) => setDraft(e.target.value)} placeholder="Share a lesson, a question or how you manage this strategy…" aria-label="Write a post" />
        <button className="solid-button" type="submit" disabled={!draft.trim()}>Post</button>
      </form>
      {message && <p className="auth-error" role="alert">{message}</p>}
      <small className="disclaimer">Share experience, not signals. No links, contact details or trade-copying requests. Nothing here is financial advice.</small>
      <div className="post-list">
        {data.posts.length === 0 && <p className="muted">No posts yet for these strategies.</p>}
        {data.posts.map((post) => (
          <article key={post.id} className="community-post">
            <div className="journal-entry-heading"><div><b>@{post.handle}</b> <span className="auto-pill">{post.strategy}</span></div><time dateTime={post.created_at}>{formatDateTime(post.created_at)}</time></div>
            <p>{post.body}</p>
            {post.replies.map((r) => <p key={r.id} className="community-reply"><b>@{r.handle}</b> {r.body} {r.mine && <button className="text-action" onClick={() => void act(() => api(token, `/api/community/posts/${r.id}`, { method: "DELETE" }))}>Delete</button>}</p>)}
            <div className="snapshot-actions">
              <button className="text-action" onClick={() => setReplyFor(replyFor === post.id ? "" : post.id)}>Reply</button>
              {post.mine ? <button className="text-action" onClick={() => void act(() => api(token, `/api/community/posts/${post.id}`, { method: "DELETE" }))}>Delete</button> : <button className="text-action" onClick={() => void act(() => api(token, `/api/community/posts/${post.id}/report`, { method: "POST" }), () => setMessage("Thanks, we received your report."))}>Report</button>}
            </div>
            {replyFor === post.id && <form className="trade-convo-form" onSubmit={(e) => { e.preventDefault(); void act(() => api(token, "/api/community/posts", { method: "POST", body: JSON.stringify({ body: replyText, parent_id: post.id }) }), () => { setReplyText(""); setReplyFor(""); }); }}><input value={replyText} maxLength={600} onChange={(e) => setReplyText(e.target.value)} placeholder="Write a reply…" aria-label="Write a reply" /><button className="solid-button" type="submit" disabled={!replyText.trim()}>Reply</button></form>}
          </article>
        ))}
      </div>
    </section>
  );
}

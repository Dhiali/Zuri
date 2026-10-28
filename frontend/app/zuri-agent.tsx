"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { backendUrl } from "./linked-account";

export type WalkthroughStep = {
  section: string;
  target: string;
  title: string;
  body: string;
  settings_tab?: string;
  symbol?: string;
  timeframe?: string;
  prefill?: { search?: string; max_trade_risk_percent?: number; max_daily_loss_percent?: number };
  needs_market?: boolean;
  how?: string[];
  links?: { label: string; url: string }[];
};
export type Walkthrough = { id: string; title: string; steps: WalkthroughStep[] };
export type ZuriAction = { id: string; type: string; args: Record<string, unknown>; label: string; at?: number };
export const TRADE_PROPOSAL_TTL_MS = 5 * 60 * 1000;
export type ZuriNudge = { id: string; kind: string; severity: string; title: string; body: string; symbol?: string | null };

const ACCESS_KEY = "zuri.assistant.access";

export function useZuriAccess() {
  const [access, setAccess] = useState({ see: false, act: false });
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? "null") as { see?: boolean; act?: boolean } | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setAccess({ see: !!stored.see, act: !!stored.act });
    } catch { /* ignore unreadable settings */ }
  }, []);
  const update = useCallback((patch: Partial<{ see: boolean; act: boolean }>) => {
    setAccess((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(ACCESS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { access, update };
}

export function logZuriEvent(token: string, kind: "approved" | "declined" | "walkthrough_finished" | "walkthrough_exited" | "nudge_opened", detail: string) {
  if (!token) return;
  void fetch(`${backendUrl}/api/zuri/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, detail: detail.slice(0, 300) }),
  }).catch(() => undefined);
}

// Zuri checks in on her own: broken risk limits, missing journal notes.
export function useZuriNudges(token: string) {
  const [nudges, setNudges] = useState<ZuriNudge[]>([]);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = () => {
      if (document.hidden) return;
      void fetch(`${backendUrl}/api/zuri/nudges`, { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => (response.ok ? response.json() : { nudges: [] }))
        .then((result: { nudges?: ZuriNudge[] }) => { if (!cancelled && Array.isArray(result.nudges)) setNudges(result.nudges); })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [token]);
  const dismiss = useCallback((id: string) => {
    setNudges((current) => current.filter((nudge) => nudge.id !== id));
    void fetch(`${backendUrl}/api/zuri/nudges/${id}/dismiss`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }, [token]);
  return { nudges, dismiss };
}

type Rect = { top: number; left: number; width: number; height: number };

// A trade is never placed by Zuri: this card shows exactly what would be sent and waits for the user's own confirm click.
export function ZuriTradeCard({ action, broker, environment, riskLimit, onConfirm, onCancel }: {
  action: ZuriAction;
  broker: string | null;
  environment: "paper" | "live" | null;
  riskLimit: number | null;
  onConfirm: (phrase: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const args = action.args as { broker_symbol: string; side: string; quantity: number; stop_loss?: number; take_profit?: number };
  const expired = now - (action.at ?? now) > TRADE_PROPOSAL_TTL_MS;
  const live = environment === "live";
  const blocked = !broker ? "Link a broker in Settings → Broker before Zuri can line up an order." : expired ? "This proposal expired. Ask Zuri to set it up again." : "";
  const ready = !blocked && !busy && (!live || phrase === "CONFIRM LIVE");
  return (
    <div className={`aura-action aura-trade${live ? " live" : ""}`}>
      <span>ZURI HAS LINED UP AN ORDER · NOT SENT YET</span>
      <strong>{action.label}</strong>
      <small>{broker ? `${broker} · ${live ? "LIVE · REAL MONEY" : "PAPER"}` : "No broker linked"}{riskLimit ? ` · your per-trade limit is ${riskLimit}%` : ""}</small>
      {args.stop_loss === undefined && <small className="aura-trade-warn">No stop-loss or target is attached.</small>}
      {live && !blocked && <input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="Type CONFIRM LIVE to enable" autoComplete="off" aria-label="Type CONFIRM LIVE" />}
      {blocked && <small className="aura-trade-warn">{blocked}</small>}
      <div>
        <button type="button" className="approve" disabled={!ready} onClick={async () => { setBusy(true); try { await onConfirm(phrase); } finally { setBusy(false); } }}>{busy ? "Sending…" : `Confirm ${args.side.toUpperCase()}`}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Zuri takes over the screen: dims it, spotlights the real control and walks the user through, applying each step for them.
export function ZuriTakeover({ walkthrough, watchlistEmpty, brokerLinked, onApplyStep, onClose }: {
  walkthrough: Walkthrough;
  watchlistEmpty: boolean;
  brokerLinked: boolean;
  onApplyStep: (step: WalkthroughStep) => void;
  onClose: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Decided once when the tour starts, so picking a market mid-tour does not shift the steps.
  const [steps] = useState(() => walkthrough.steps.filter((item) => !item.needs_market || watchlistEmpty));
  const step = steps[index];
  const last = index === steps.length - 1;

  // Linking a broker while the broker steps are showing skips ahead to the "You're linked" step.
  const wasLinked = useRef(brokerLinked);
  useEffect(() => {
    if (brokerLinked && !wasLinked.current && /^Step \d+ of \d+/.test(step.title)) {
      const done = steps.findIndex((item) => item.title.startsWith("Step 7 of 7"));
      if (done > index) setTimeout(() => setIndex(done), 0);
    }
    wasLinked.current = brokerLinked;
  }, [brokerLinked, step, steps, index]);
  // Give the target a moment to appear (a page may still be switching) before saying it isn't there.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const reset = window.setTimeout(() => setWaited(false), 0);
    const timer = window.setTimeout(() => setWaited(true), 1200);
    return () => { window.clearTimeout(reset); window.clearTimeout(timer); };
  }, [index]);

  useEffect(() => { onApplyStep(step); }, [step, onApplyStep]);

  useEffect(() => {
    let scrolledTo: Element | null = null;
    const measure = () => {
      const element = document.querySelector<HTMLElement>(`[data-zuri-target="${step.target}"]`);
      if (!element) { setRect(null); return; }
      const before = element.getBoundingClientRect();
      // Bring an off-screen target into view once, so the user can still scroll afterwards.
      if (scrolledTo !== element) {
        scrolledTo = element;
        if (before.top < 0 || before.bottom > window.innerHeight || before.left < 0 || before.right > window.innerWidth) {
          element.scrollIntoView({ block: before.height > window.innerHeight * 0.7 ? "start" : "center", inline: "nearest" });
        }
      }
      const box = element.getBoundingClientRect();
      setRect((current) => (current && current.top === box.top && current.left === box.left && current.width === box.width && current.height === box.height ? current : { top: box.top, left: box.left, width: box.width, height: box.height }));
    };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", measure); };
  }, [step.target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ step: number; x: number; y: number } | null>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const offset = drag && drag.step === index ? drag : { x: 0, y: 0 };
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [cardH, setCardH] = useState(220);

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const hasTarget = rect !== null;
  useEffect(() => {
    const height = cardRef.current?.offsetHeight;
    if (height) setCardH(height);
  }, [index, hasTarget]);

  const MARGIN = 12;
  const cardW = Math.min(360, view.w - 2 * MARGIN);
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), view.w - cardW - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), view.h - cardH - MARGIN);
  const place = (): { top: number; left: number } => {
    if (!rect) return { top: clampY(view.h - cardH - 28), left: clampX((view.w - cardW) / 2) };
    const gap = 16;
    const centreX = rect.left + rect.width / 2 - cardW / 2;
    const centreY = rect.top + rect.height / 2 - cardH / 2;
    const candidates = [
      { top: rect.top + rect.height + gap, left: centreX },
      { top: rect.top - cardH - gap, left: centreX },
      { top: centreY, left: rect.left - cardW - gap },
      { top: centreY, left: rect.left + rect.width + gap },
    ];
    const fits = (c: { top: number; left: number }) => c.top >= MARGIN && c.left >= MARGIN && c.top + cardH <= view.h - MARGIN && c.left + cardW <= view.w - MARGIN;
    const spot = candidates.find(fits);
    if (spot) return { top: spot.top, left: clampX(spot.left) };
    // Nothing fits beside the target (it fills the screen): park in the bottom corner on the side away from its centre.
    const targetOnLeft = rect.left + rect.width / 2 < view.w / 2;
    return { top: clampY(view.h - cardH - 28), left: targetOnLeft ? view.w - cardW - MARGIN : MARGIN };
  };
  const base = place();
  const cardStyle: React.CSSProperties = { top: clampY(base.top + offset.y), left: clampX(base.left + offset.x) };

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { px: event.clientX, py: event.clientY, x: offset.x, y: offset.y };
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setDrag({ step: index, x: start.x + event.clientX - start.px, y: start.y + event.clientY - start.py });
  };
  const endDrag = () => { dragStart.current = null; };

  return (
    <div className="zuri-takeover" role="dialog" aria-label={`Zuri guide: ${walkthrough.title}`}>
      {rect ? <div className="zuri-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="zuri-dim" />}
      <div className="zuri-takeover-card" ref={cardRef} style={cardStyle}>
        <span className="zuri-takeover-kicker zuri-drag-handle" title="Drag to move" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>⠿ ZURI IS GUIDING YOU · {index + 1}/{steps.length} · DRAG TO MOVE</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        {step.how && step.how.length > 0 && <ol className="zuri-takeover-how">{step.how.map((line) => <li key={line}>{line}</li>)}</ol>}
        {step.links && step.links.length > 0 && <div className="zuri-takeover-links">{step.links.filter((link) => link.url.startsWith("https://")).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}</div>}
        {!rect && waited && !step.needs_market && <p className="zuri-takeover-note">This part of the screen isn&apos;t showing yet, so there is nothing to highlight. It appears once you add a market or link a broker.</p>}
        <div className="zuri-takeover-actions">
          <button type="button" className="zuri-ghost" onClick={() => onClose(false)}>Exit</button>
          <span />
          <button type="button" className="zuri-ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button>
          <button type="button" className="zuri-primary" onClick={() => (last ? onClose(true) : setIndex(index + 1))}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}

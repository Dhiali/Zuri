"use client";

import { useCallback, useEffect, useState } from "react";
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
export function ZuriTakeover({ walkthrough, onApplyStep, onClose }: {
  walkthrough: Walkthrough;
  onApplyStep: (step: WalkthroughStep) => void;
  onClose: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = walkthrough.steps[index];
  const last = index === walkthrough.steps.length - 1;

  useEffect(() => { onApplyStep(step); }, [step, onApplyStep]);

  useEffect(() => {
    const measure = () => {
      const element = document.querySelector<HTMLElement>(`[data-zuri-target="${step.target}"]`);
      if (!element) { setRect(null); return; }
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
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

  const cardStyle: React.CSSProperties = rect
    ? (rect.top + rect.height + 220 < window.innerHeight
      ? { top: rect.top + rect.height + 14, left: Math.min(Math.max(12, rect.left), window.innerWidth - 372) }
      : { top: Math.max(12, rect.top - 214), left: Math.min(Math.max(12, rect.left), window.innerWidth - 372) })
    : { top: "40%", left: "50%", transform: "translateX(-50%)" };

  return (
    <div className="zuri-takeover" role="dialog" aria-label={`Zuri guide: ${walkthrough.title}`}>
      {rect ? <div className="zuri-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="zuri-dim" />}
      <div className="zuri-takeover-card" style={cardStyle}>
        <span className="zuri-takeover-kicker">ZURI IS GUIDING YOU · {index + 1}/{walkthrough.steps.length}</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
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

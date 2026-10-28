"use client";

import { useEffect, useRef, useState } from "react";
import { backendUrl } from "./linked-account";
import { ZuriMascot } from "./zuri-journey";

export type TradePlan = {
  symbol: string;
  side: "buy" | "sell";
  price: number;
  stop_loss: number;
  take_profit: number;
  units: number;
  lots?: number;
  risk_amount?: number;
  actual_risk?: number;
  notional?: number;
  risk_percent: number;
  reward_to_risk: number | null;
  levels_source: "zuri" | "proposed";
  stops_supported: boolean;
  warnings: string[];
};

type Message = { role: "user" | "assistant"; content: string };

const opener = (symbol: string) => `Hi! What are you thinking about ${symbol || "trading"} today? Tell me your idea in your own words and we'll talk it through. If we agree a plan I can fill the ticket, and you press send. You can also just use the ticket yourself.`;

export function TradeConversation({ token, symbol, riskPercent, ready, onUsePlan }: { token: string; symbol: string; riskPercent: number; ready: boolean; onUsePlan: (plan: TradePlan) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emote, setEmote] = useState("👋");
  const [plan, setPlan] = useState<TradePlan | null>(null);
  const [used, setUsed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || !ready) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    setEmote("🤔");
    try {
      const response = await fetch(`${backendUrl}/api/trade/converse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next.slice(-12), symbol: symbol || null, risk_percent: riskPercent }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Zuri could not respond.");
      setMessages([...next, { role: "assistant", content: body.reply }]);
      setEmote(body.emote ?? "💡");
      setPlan(body.plan ?? null);
      setUsed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zuri could not respond.");
      setEmote("⚠️");
    } finally {
      setBusy(false);
    }
  }

  const shown: Message[] = messages.length ? messages : [{ role: "assistant", content: opener(symbol) }];
  const money = (value?: number) => (typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—");

  return (
    <section className="content-card trade-convo" data-zuri-target="trade-convo">
      <div className="trade-convo-zuri"><ZuriMascot mood={busy ? "talking" : "idle"} size={52} emote={emote} /></div>
      <div className="trade-convo-body">
        <div><span className="small-label">OPTIONAL · NEED HELP DECIDING?</span><h2>Talk your idea through with Zuri</h2></div>
        <div className="trade-convo-log" aria-live="polite">
          {shown.map((message, index) => <p key={index} className={message.role === "user" ? "convo-user" : "convo-zuri"}>{message.content}</p>)}
          {busy && <p className="convo-zuri convo-typing">Zuri is thinking…</p>}
          <div ref={endRef} />
        </div>
        {plan && (
          <div className="trade-plan">
            <div className="trade-plan-head"><b>{plan.side === "buy" ? "Buy" : "Sell"} {plan.symbol}</b><span>{plan.levels_source === "zuri" ? "Zuri chose the stop and target from recent price swings" : "Using your levels"}</span></div>
            {plan.units > 0 ? (
              <div className="trade-plan-grid">
                <span>Size<b>{plan.units.toLocaleString()} units{plan.lots !== undefined ? ` (${plan.lots} lots)` : ""}</b></span>
                <span>Entry (approx.)<b>{plan.price}</b></span>
                <span>Stop<b>{plan.stop_loss}</b></span>
                <span>Target<b>{plan.take_profit}</b></span>
                <span>Risk<b>{money(plan.actual_risk)} ({plan.risk_percent}%)</b></span>
                <span>Reward : risk<b>{plan.reward_to_risk ?? "—"} : 1</b></span>
              </div>
            ) : <p className="auth-message">Zuri could not size this trade.</p>}
            {plan.warnings.map((warning) => <p key={warning} className="auth-message" role="note">{warning}</p>)}
            {plan.units > 0 && <button className="solid-button" disabled={used} onClick={() => { onUsePlan(plan); setUsed(true); setEmote("✅"); }}>{used ? "Filled into the order ticket" : "Use this plan in the order ticket"}</button>}
            <small className="disclaimer">Zuri never places the trade for you. Review the ticket, then confirm it yourself.</small>
          </div>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {!ready && <p className="auth-message">Link a broker in Settings to talk through a trade with live numbers.</p>}
        <form className="trade-convo-form" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
          <div className="trade-convo-composer">
            <input value={input} maxLength={500} onChange={(event) => setInput(event.target.value)} placeholder={`e.g. "I think ${symbol || "AAPL"} will bounce, size it for me"`} disabled={!ready || busy} aria-label="Message Zuri" />
            <button className="solid-button" type="submit" disabled={!ready || busy || !input.trim()}>Send</button>
          </div>
        </form>
      </div>
    </section>
  );
}

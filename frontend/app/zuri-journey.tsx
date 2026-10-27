"use client";

import type { ZuriJourney } from "./user-data";

export type Section = "Charts" | "Dashboard" | "Trade" | "History" | "Journal" | "Settings";
type Mood = "idle" | "talking" | "celebrating";

export type ZuriExpression = "neutral" | "happy" | "thinking" | "surprised" | "sad";
export type ZuriGesture = "nod" | "shake";

function expressionFor(mood: Mood, emote?: string): ZuriExpression {
  if (mood === "celebrating" || emote === "🎉" || emote === "✅") return "happy";
  if (emote === "🤔" || emote === "🧐" || mood === "talking") return "thinking";
  if (emote === "💪") return "sad";
  return "neutral";
}

export function ZuriMascot({ mood = "idle", size = 120, emote, expression, gesture }: { mood?: Mood; size?: number; emote?: string; expression?: ZuriExpression; gesture?: ZuriGesture }) {
  const look = expression ?? expressionFor(mood, emote);
  return (
    <div className="zuri-figure" style={{ width: size, height: size }}>
    <i className="zuri-halo" aria-hidden="true" />
    <div className={`zuri-move${gesture ? ` zuri-${gesture}` : ""}`}>
    <svg className={`zuri-mascot zuri-${mood} zuri-ex-${look}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Zuri, your trading assistant">
      <defs>
        <linearGradient id="zuri-body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#d8c3ff" />
          <stop offset=".55" stopColor="#9a74ee" />
          <stop offset="1" stopColor="#6b46d0" />
        </linearGradient>
        <linearGradient id="zuri-visor" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#201833" />
          <stop offset="1" stopColor="#0b0813" />
        </linearGradient>
        <radialGradient id="zuri-eye" cx=".5" cy=".4" r=".6">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#cdb5ff" />
        </radialGradient>
      </defs>
      <rect x="1" y="49" width="9" height="24" rx="4.5" fill="#8760e0" />
      <rect x="110" y="49" width="9" height="24" rx="4.5" fill="#8760e0" />
      <rect x="7" y="12" width="106" height="98" rx="49" fill="url(#zuri-body)" />
      <rect x="7.5" y="12.5" width="105" height="97" rx="48.5" fill="none" stroke="#ffffff" strokeOpacity=".3" />
      <ellipse cx="42" cy="22" rx="22" ry="6" fill="#ffffff" opacity=".28" transform="rotate(-14 42 22)" />
      <rect x="19" y="32" width="82" height="54" rx="27" fill="url(#zuri-visor)" />
      <rect x="19.5" y="32.5" width="81" height="53" rx="26.5" fill="none" stroke="#ffffff" strokeOpacity=".1" />
      {[{ cx: 43, side: "l" }, { cx: 77, side: "r" }].map(({ cx, side }) => (
        <g key={side}>
          <g transform={`translate(${cx} 43)`}><g className={`zuri-brow zuri-brow-${side}`}><path d="M-7 0 H7" stroke="#e6d8ff" strokeWidth="3.4" strokeLinecap="round" /></g></g>
          <g transform={`translate(${cx} 63)`}>
            <g className="zuri-eye">
              <g className="zuri-blink">
                <rect className="zuri-eye-open" x="-5" y="-10" width="10" height="20" rx="5" fill="url(#zuri-eye)" />
                <path className="zuri-eye-happy" d="M-7 4 Q0 -9 7 4" fill="none" stroke="#f1e8ff" strokeWidth="4" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </g>
      ))}
      {mood === "celebrating" && (
        <g className="zuri-sparkles" fill="#e9dcff">
          <path d="M10 40 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" />
          <path d="M108 30 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z" />
        </g>
      )}
    </svg>
    </div>
    {emote && <span className="zuri-emote" key={emote} aria-hidden="true">{emote}</span>}
    </div>
  );
}

type Step = {
  id: string;
  title: string;
  why: string;
  quick: string;
  action?: { label: string; section?: Section; href?: string };
  auto?: boolean;
};

const steps: Step[] = [
  {
    id: "broker-account",
    title: "Open a free demo broker account",
    why: "A broker is the licensed company that holds your money and actually carries out your trades. Zuri never holds funds. You connect to your broker, just like connecting MetaTrader 5 to a broker server. We’ll start with a free paper account that uses practice money, so nothing is at risk. Sign up at alpaca.markets and choose a paper account.",
    quick: "Create a free Alpaca paper account at alpaca.markets. It uses simulated money.",
    action: { label: "Open Alpaca", href: "https://alpaca.markets" },
  },
  {
    id: "broker-keys",
    title: "Create your API keys",
    why: "API keys are like a password that lets Zuri place trades for you without ever seeing your login. In Alpaca’s paper dashboard, find “API Keys” and generate a new key. You’ll get a Key ID and a Secret. The secret is shown only once, so copy it somewhere safe. Never enable withdrawals on a key.",
    quick: "In Alpaca’s paper dashboard, generate an API key ID and secret (trading permissions only).",
  },
  {
    id: "broker-link",
    title: "Link your broker to Zuri",
    why: "Paste your Key ID and Secret into Settings → Broker and choose Paper. Zuri checks them with the broker, then stores them encrypted. This is the same step you’d take to link a real-money account later.",
    quick: "Paste the key and secret in Settings → Broker and choose Paper.",
    action: { label: "Open Settings → Broker", section: "Settings" },
    auto: true,
  },
  {
    id: "first-trade",
    title: "Place your first paper trade",
    why: "Pick a small size, buy or sell, and confirm. Don’t worry about winning. The goal is to see how an order flows from Zuri to your broker and back into your positions.",
    quick: "Place a small confirmed paper order from the Trade tab.",
    action: { label: "Open Trade", section: "Trade" },
    auto: true,
  },
  {
    id: "first-journal",
    title: "Write your first journal note",
    why: "Before or after a trade, write why you took it and how you felt. Over time, this is how you spot the habits that cost you money.",
    quick: "Log a journal note on your first trade.",
    action: { label: "Open Journal", section: "Journal" },
    auto: true,
  },
  {
    id: "risk-rules",
    title: "Review your risk limits",
    why: "Risk limits are your seatbelt. Check that your per-trade risk is small (1–2% is a common guideline) and that your daily loss limit suits you.",
    quick: "Check your per-trade and daily risk limits.",
    action: { label: "Open Settings", section: "Settings" },
  },
];

export function JourneyChecklist({
  journey,
  brokerLinked,
  hasPositions,
  journalCount,
  onChange,
  setSection,
}: {
  journey: ZuriJourney;
  brokerLinked: boolean;
  hasPositions: boolean;
  journalCount: number;
  onChange: (next: ZuriJourney) => void;
  setSection: (section: Section) => void;
}) {
  const level = journey.level ?? "foundations";
  const done = (step: Step) =>
    journey.completed_steps.includes(step.id) ||
    (step.id === "broker-link" && brokerLinked) ||
    (step.id === "first-trade" && hasPositions) ||
    (step.id === "first-journal" && journalCount > 0);
  const completedCount = steps.filter(done).length;
  const next = steps.find((step) => !done(step));
  const detailed = level === "foundations";

  const markDone = (id: string) => onChange({ ...journey, completed_steps: [...journey.completed_steps, id] });

  return (
    <section className="content-card zuri-checklist">
      <div className="zuri-checklist-head">
        <ZuriMascot mood={next ? "idle" : "celebrating"} size={64} />
        <div>
          <span className="small-label">ZURI · YOUR NEXT STEPS · {completedCount} OF {steps.length}</span>
          <h2>{next ? next.title : "You’re all set. Great work!"}</h2>
          {next ? <p>{detailed ? next.why : next.quick}</p> : <p>Your broker is linked and you’ve covered the essentials. Keep journaling, keep your risk small and ask me anything.</p>}
          {next && (
            <div className="zuri-tour-actions">
              {next.action?.href && <a className="outline-button" href={next.action.href} target="_blank" rel="noreferrer">{next.action.label} ↗</a>}
              {next.action?.section && <button className="outline-button" onClick={() => setSection(next.action!.section!)}>{next.action.label} →</button>}
              {!next.auto && <button className="solid-button" onClick={() => markDone(next.id)}>I’ve done this</button>}
            </div>
          )}
        </div>
      </div>
      <ol className="zuri-steps">
        {steps.map((step) => <li key={step.id} className={done(step) ? "done" : step === next ? "current" : ""}><span>{done(step) ? "✓" : ""}</span>{step.title}</li>)}
      </ol>
    </section>
  );
}

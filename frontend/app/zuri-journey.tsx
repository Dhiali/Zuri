"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { ZuriJourney, ZuriLevel, ZuriMode } from "./user-data";

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

export function ZuriWelcome({ experience, accessToken, section, onFinish, onSkip }: { experience: string | undefined; accessToken: string; section: string; onFinish: () => void; onSkip: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [length, setLength] = useState(0);
  const [look, setLook] = useState<ZuriExpression>("surprised");
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = document.querySelector(".zuri-top")?.getBoundingClientRect();
      setAnchor(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth - 200, y: 40 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    const key = "zuri-welcome-visits";
    const previous = Number(window.localStorage.getItem(key) ?? "0") || 0;
    window.localStorage.setItem(key, String(previous + 1));
    const isReturning = previous > 0;
    const fallback = isReturning
      ? "Welcome back. I'm not sure where we left off, so we can start the lay of the land again or skip it."
      : `Hi, I'm Zuri, your trading expert assistant. ${experience === "Experienced" ? "I'll give you a quick lay of the land" : "Since you're new to trading, I'll give you a simple but detailed lay of the land"} before we start setting things up.`;
    const controller = new AbortController();
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
    const frame = window.requestAnimationFrame(() => setReturning(isReturning));
    fetch(`${backendUrl}/api/zuri/greeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ visit: isReturning ? "returning" : "first", visit_count: previous + 1, local_hour: new Date().getHours(), section, welcome_shown_before: isReturning }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("greeting failed"))))
      .then((data: { message?: string }) => setText(data.message?.trim() || fallback))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setText(fallback);
      });
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
    // Greet once per mount; token refreshes must not trigger a new greeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (text === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => { setLength(text.length); setLook("happy"); });
      return () => window.cancelAnimationFrame(frame);
    }
    let timer: number | undefined;
    const start = window.setTimeout(() => {
      setLook("happy");
      timer = window.setInterval(() => setLength((current) => (current >= text.length ? current : current + 1)), 28);
    }, 1500);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [text]);

  const done = text !== null && length >= text.length;
  const figureSize = 64;
  const dropY = Math.round(window.innerHeight * 0.3);

  return (
    <div className="zuri-welcome" role="dialog" aria-modal="true" aria-label="Meet Zuri">
      {anchor && (
        <>
          <div className="zuri-welcome-figure" style={{ left: anchor.x - figureSize / 2, top: anchor.y - figureSize / 2 + dropY }}>
            <ZuriMascot size={figureSize} expression={text === null ? "thinking" : look} gesture={done ? "nod" : undefined} />
          </div>
          <div className="zuri-welcome-bubble" style={{ top: anchor.y + figureSize / 2 + 16 + dropY, right: Math.max(16, window.innerWidth - anchor.x - 28) }} aria-live="polite">
            <span className="zuri-welcome-name">Zuri · Trading expert</span>
            <p>{text === null ? <span className="iv-caret" aria-hidden="true" /> : <>{text.slice(0, length)}{!done && <span className="iv-caret" aria-hidden="true" />}</>}</p>
            <div className="zuri-welcome-actions">
              <button type="button" className="solid-button" onClick={onFinish} disabled={!done}>{returning ? "Start the lay of the land" : "Show me the lay of the land"}</button>
              <button type="button" className="zuri-skip" onClick={onSkip}>Skip</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const quiz = [
  { q: "What does it mean to “go long” on a stock?", options: ["Hold it for years", "Buy it expecting the price to rise", "Sell it expecting the price to fall", "Buy and sell it in one day"], answer: 1, why: "Going long means buying because you expect the price to go up. Selling to profit from a fall is called going short." },
  { q: "What is a stop-loss order for?", options: ["To lock in a guaranteed profit", "To automatically exit a trade if price moves against you by a set amount", "To buy more when price falls", "To stop trading for the day"], answer: 1, why: "A stop-loss caps how much a single trade can lose by closing it at a price you chose in advance." },
  { q: "A common beginner guideline is to risk about how much of your account on one trade?", options: ["50%", "25%", "1–2%", "Whatever feels right"], answer: 2, why: "Risking only 1–2% means a string of losses cannot wipe you out, so you stay in the game long enough to learn." },
  { q: "What is leverage?", options: ["Free money from your broker", "Borrowing to control a larger position than your cash alone allows", "A type of chart", "A trading fee"], answer: 1, why: "Leverage magnifies both gains and losses. It is the fastest way beginners lose money, so use it carefully." },
  { q: "What is the difference between a market order and a limit order?", options: ["There is none", "Market fills now at the best available price; limit fills only at your price or better", "Limit orders are always cheaper", "Market orders only work on weekends"], answer: 1, why: "A market order prioritises speed; a limit order prioritises price, but may never fill." },
  { q: "What is the “spread”?", options: ["The difference between the bid and ask price", "Your daily profit", "How many markets you trade", "The broker’s phone number"], answer: 0, why: "The spread is the gap between what buyers will pay (bid) and sellers will accept (ask). It is a built-in cost of every trade." },
  { q: "If you risk $50 to potentially make $150, what is the risk-to-reward ratio?", options: ["1:3", "3:1", "1:1", "50:150 is not a ratio"], answer: 0, why: "Risking 1 to make 3 is 1:3. With a ratio like that you can be wrong more often than right and still come out ahead." },
  { q: "Why use a paper (demo) account first?", options: ["It pays real profits", "To practise with simulated money while you learn the platform and your own habits", "Because real accounts are illegal for beginners", "It has better prices"], answer: 1, why: "Paper trading lets you make beginner mistakes for free, so the lessons cost nothing." },
  { q: "You are down on a trade and the price keeps falling. What is the disciplined move?", options: ["Move your stop-loss further away", "Double your position to win it back", "Stick to the exit plan you made before entering", "Close your eyes and wait"], answer: 2, why: "Plans made before the trade protect you from emotion. Moving stops or doubling down is how small losses become big ones." },
  { q: "What is a trading journal mainly for?", options: ["Showing off wins", "Reviewing your decisions to find patterns and improve", "Tax only", "Predicting the market"], answer: 1, why: "Writing down why you entered and how you felt is how traders spot repeat mistakes and actually improve." },
];

export function levelForScore(score: number): ZuriLevel {
  if (score >= 8) return "advancing";
  if (score >= 5) return "building";
  return "foundations";
}

const levelCopy: Record<ZuriLevel, { title: string; text: string }> = {
  foundations: { title: "Foundations", text: "You’re at the start of the journey, which is exactly where Zuri is strongest. I’ll use plain language, explain the why behind everything and move one small step at a time." },
  building: { title: "Building", text: "You know the basics. I’ll skip the very beginner explanations, add some depth and start challenging how you plan and manage risk." },
  advancing: { title: "Advancing", text: "You have solid fundamentals. I’ll keep things concise, focus on trade-offs and discipline, and help you sharpen your process." },
};

export function levelFromExperience(experience: string | undefined): ZuriLevel {
  if (experience === "Experienced") return "advancing";
  if (experience === "Learning the basics") return "building";
  return "foundations";
}

const introSlides = [
  { emote: "👋", title: "Hi, I’m Zuri.", text: "I’m your AI trading assistant. Think of me as a calm, knowledgeable friend who sits beside you while you trade." },
  { emote: "💡", title: "Here’s how I help.", text: "I explain trading ideas in plain language, check your risk before you act, keep your journal honest and answer any question, any time." },
  { emote: "📈", title: "And I evolve you.", text: "I learn your level and your interests, then adapt. As you grow, I grow with you. First, let me show you around." },
];

const tourSteps: { section: Section; title: string; text: string }[] = [
  { section: "Dashboard", title: "Your dashboard", text: "This is home base. You’ll see your real broker balance, open positions, today’s market news and a checklist of what to do next." },
  { section: "Trade", title: "The order ticket", text: "This is where orders are placed. Everything here asks you to confirm first, and live-money orders need an extra safety phrase." },
  { section: "Journal", title: "Your journal", text: "Write down why you take a trade. Reviewing it later is the fastest way to improve." },
  { section: "Settings", title: "Settings and broker", text: "Your broker connection, risk limits and account details live here. We’ll link your broker in a moment." },
];

export function ZuriJourneyOverlay({
  journey,
  experience,
  onChange,
  setSection,
}: {
  journey: ZuriJourney;
  experience: string | undefined;
  onChange: (next: ZuriJourney) => void;
  setSection: (section: Section) => void;
}) {
  const [slide, setSlide] = useState(0);
  const [tourStep, setTourStep] = useState(0);
  const [question, setQuestion] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const advance = (patch: Partial<ZuriJourney>) => onChange({ ...journey, ...patch });

  if (journey.phase === "intro") {
    const current = introSlides[slide];
    const last = slide === introSlides.length - 1;
    return (
      <div className="zuri-stage" role="dialog" aria-modal="true" aria-label="Meet Zuri">
        <div className="zuri-stage-card">
          <ZuriMascot size={260} emote={current.emote} />
          <h2>{current.title}</h2>
          <p>{current.text}</p>
          <div className="zuri-dots" aria-hidden="true">{introSlides.map((_, index) => <i key={index} className={index === slide ? "active" : ""} />)}</div>
          <button className="solid-button" onClick={() => { if (last) { setSection("Dashboard"); advance({ phase: "tour" }); } else setSlide(slide + 1); }}>
            {last ? "Show me around" : "Next"}
          </button>
        </div>
      </div>
    );
  }

  if (journey.phase === "tour") {
    const step = tourSteps[tourStep];
    const last = tourStep === tourSteps.length - 1;
    const goTo = (index: number) => { setTourStep(index); setSection(tourSteps[index].section); };
    return (
      <aside className="zuri-tour" role="dialog" aria-label="Zuri’s tour">
        <ZuriMascot size={64} emote="👉" />
        <div>
          <span className="small-label">QUICK TOUR · {tourStep + 1} OF {tourSteps.length}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <div className="zuri-tour-actions">
            <button className="text-action" onClick={() => advance({ phase: "mode" })}>Skip tour</button>
            {tourStep > 0 && <button className="outline-button" onClick={() => goTo(tourStep - 1)}>Back</button>}
            <button className="solid-button" onClick={() => { if (last) { setSection("Dashboard"); advance({ phase: "mode" }); } else goTo(tourStep + 1); }}>{last ? "Done" : "Next"}</button>
          </div>
        </div>
      </aside>
    );
  }

  if (journey.phase === "mode") {
    const choose = (mode: ZuriMode) => {
      if (mode === "coach") advance({ mode, phase: "quiz" });
      else advance({ mode, phase: "done", level: levelFromExperience(experience) });
    };
    return (
      <div className="zuri-stage" role="dialog" aria-modal="true" aria-label="Choose how Zuri works with you">
        <div className="zuri-stage-card wide">
          <ZuriMascot size={260} emote="🤔" />
          <h2>How would you like me to work with you?</h2>
          <p>You can change this any time in Settings.</p>
          <div className="zuri-choices">
            <button className="zuri-choice" onClick={() => choose("coach")}>
              <b>Training buddy</b>
              <span>I’ll hold your hand and evolve you as a trader. You’ll take a short quiz so I know where to start, then I’ll guide you step by step.</span>
            </button>
            <button className="zuri-choice" onClick={() => choose("assistant")}>
              <b>Assistant</b>
              <span>You grow your skills your own way. I stay in the background and answer questions, check risk and help when you ask.</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (journey.phase === "quiz") {
    if (finished) {
      const level = levelForScore(score);
      return (
        <div className="zuri-stage" role="dialog" aria-modal="true" aria-label="Your starting level">
          <div className="zuri-stage-card">
            <ZuriMascot mood="celebrating" size={260} emote="🎉" />
            <span className="small-label">YOU SCORED {score} / {quiz.length}</span>
            <h2>Your starting level: {levelCopy[level].title}</h2>
            <p>{levelCopy[level].text}</p>
            <button className="solid-button" onClick={() => { setSection("Dashboard"); advance({ phase: "done", level, quiz_score: score }); }}>Let’s get set up</button>
          </div>
        </div>
      );
    }
    const item = quiz[question];
    const answered = picked !== null;
    return (
      <div className="zuri-stage" role="dialog" aria-modal="true" aria-label="Level quiz">
        <div className="zuri-stage-card wide quiz">
          <ZuriMascot size={260} emote={!answered ? "🧐" : picked === item.answer ? "✅" : "💪"} />
          <span className="small-label">QUESTION {question + 1} OF {quiz.length}</span>
          <h2>{item.q}</h2>
          <div className="zuri-options">
            {item.options.map((option, index) => {
              const state = !answered ? "" : index === item.answer ? " correct" : index === picked ? " wrong" : "";
              return <button key={option} className={`zuri-option${state}`} disabled={answered} onClick={() => { setPicked(index); if (index === item.answer) setScore(score + 1); }}>{option}</button>;
            })}
          </div>
          {answered && <p className="zuri-feedback" role="status"><b>{picked === item.answer ? "Nice! " : "Not quite. "}</b>{item.why}</p>}
          {answered && <button className="solid-button" onClick={() => { setPicked(null); if (question === quiz.length - 1) setFinished(true); else setQuestion(question + 1); }}>{question === quiz.length - 1 ? "See my level" : "Next question"}</button>}
        </div>
      </div>
    );
  }

  return null;
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
          <span className="small-label">ZURI · YOUR NEXT STEPS · {completedCount} OF {steps.length}{journey.mode === "coach" ? " · TRAINING BUDDY" : ""}</span>
          <h2>{next ? next.title : "You’re all set. Great work!"}</h2>
          {next ? <p>{detailed || journey.mode === "coach" ? next.why : next.quick}</p> : <p>Your broker is linked and you’ve covered the essentials. Keep journaling, keep your risk small and ask me anything.</p>}
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

"use client";

import { useEffect, useState } from "react";

const XAU_QUESTION = "What is happening with the XAUUSD?";
const XAU_ANSWER = "XAUUSD is gold priced in US dollars. It tends to move opposite the dollar and with shifts in rate expectations, so watch yields and the dollar index alongside the chart. In this demo, price is holding above recent support. I can't predict the next move, but I can help you map key levels and size your risk.";

function JargonVisual() {
  return (
    <div className="iv-panel" aria-label="Preview of asking the Zuri trading expert">
      <div className="iv-chat" aria-live="polite">
        <div className="iv-bubble iv-bubble-user">{XAU_QUESTION}</div>
        <div className="iv-bubble iv-bubble-ai">
          <span className="iv-ai-name">✳ Zuri · Trading expert</span>
          <TypedText text={XAU_ANSWER} />
        </div>
      </div>
    </div>
  );
}

const EQUITY = [10000, 10040, 10020, 10090, 10060, 10150, 10120, 10080, 10170, 10240, 10200, 10290, 10260, 10230, 10340, 10410, 10370, 10450, 10420, 10390, 10520, 10590, 10560, 10640, 10610, 10700, 10680, 10760, 10730, 10810, 10840];
const START_BALANCE = EQUITY[0];
const WIN_RATE = 58;
const CHART_W = 320;
const CHART_H = 150;
const EQ_MIN = 9960;
const EQ_MAX = 10880;

const eqX = (index: number) => (index / (EQUITY.length - 1)) * CHART_W;
const eqY = (value: number) => CHART_H - ((value - EQ_MIN) / (EQ_MAX - EQ_MIN)) * CHART_H;
const money = (value: number) => `${value < 0 ? "−" : "+"}$${Math.abs(value).toLocaleString("en-US")}`;

function TradeVisual() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => setShown(EQUITY.length - 1));
      return () => window.cancelAnimationFrame(frame);
    }
    let timer: number | undefined;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        setShown((current) => {
          if (current >= EQUITY.length - 1) {
            window.clearInterval(timer);
            return current;
          }
          return current + 1;
        });
      }, 95);
    }, 500);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, []);

  const visible = EQUITY.slice(0, shown + 1);
  const line = visible.map((value, index) => `${index === 0 ? "M" : "L"}${eqX(index).toFixed(1)} ${eqY(value).toFixed(1)}`).join(" ");
  const result = EQUITY[shown] - START_BALANCE;
  const worstDip = visible.reduce(
    (state, value) => {
      const peak = Math.max(state.peak, value);
      return { peak, worst: Math.min(state.worst, value - peak) };
    },
    { peak: START_BALANCE, worst: 0 },
  ).worst;
  const winRate = Math.round((WIN_RATE * shown) / (EQUITY.length - 1));

  return (
    <div className="iv-panel" aria-label="Preview of testing a trading idea in a practice account">
      <div className="iv-block iv-chart">
        <div className="iv-block-head">
          <b>BUY PULLBACKS IN AN UPTREND · XAUUSD · 30 DAYS</b>
          <span>${EQUITY[shown].toLocaleString("en-US")}</span>
        </div>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label="Practice account balance rising over 30 days">
          <defs>
            <linearGradient id="iv-eq" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#c4a2ff" stopOpacity=".28" />
              <stop offset="100%" stopColor="#c4a2ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="iv-cross" x1="0" x2={CHART_W} y1={eqY(START_BALANCE)} y2={eqY(START_BALANCE)} />
          {shown > 0 && <path d={`${line} L${eqX(shown).toFixed(1)} ${CHART_H} L0 ${CHART_H} Z`} fill="url(#iv-eq)" />}
          <path d={line} className="iv-trade-line" />
          <circle className="iv-dot" cx={eqX(shown)} cy={eqY(EQUITY[shown])} r="4.5" />
        </svg>
      </div>
      <dl className="iv-eq-stats" aria-live="polite">
        <div><dt>Result</dt><dd className={result >= 0 ? "up" : "down"}>{money(result)}</dd></div>
        <div><dt>Winning trades</dt><dd>{shown === 0 ? "–" : `${winRate}%`}</dd></div>
        <div><dt>Worst dip</dt><dd className="down">{money(worstDip)}</dd></div>
      </dl>
    </div>
  );
}

function TypedText({ text }: { text: string }) {
  const [length, setLength] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => setLength(text.length));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setInterval(() => setLength((current) => (current >= text.length ? current : current + 2)), 22);
    return () => window.clearInterval(timer);
  }, [text]);

  return <>{text.slice(0, length)}{length < text.length && <span className="iv-caret" aria-hidden="true" />}</>;
}

const JOURNEY = [
  { title: "Create your free account", detail: "Takes under a minute" },
  { title: "Your $10,000 practice desk is ready", detail: "Real market feel, zero risk" },
  { title: "Ask Zuri anything", detail: "Your trading expert, on call" },
  { title: "Place your first trade", detail: "Plan it, test it, learn from it" },
] as const;

function JourneyVisual() {
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => setDone(JOURNEY.length));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setInterval(() => setDone((current) => (current >= JOURNEY.length ? current : current + 1)), 900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="iv-panel" aria-label="Preview of the path from sign-up to your first trade">
      <ol className="iv-journey">
        {JOURNEY.map((item, index) => (
          <li key={item.title} className={index < done ? "is-done" : index === done ? "is-active" : ""}>
            <span className="iv-journey-mark">{index < done ? "✓" : index + 1}</span>
            <span><b>{item.title}</b><small>{item.detail}</small></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function IntroVisual({ step }: { step: number }) {
  if (step === 0) return <JargonVisual />;
  if (step === 1) return <TradeVisual />;
  return <JourneyVisual />;
}

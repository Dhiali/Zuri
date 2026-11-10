"use client";

import { ZuriMascot } from "./zuri-journey";

export const COACH_STEP_COUNT = 5;

const STEPS = [
  {
    title: "Choose the market",
    why: "Decide what you're trading. Pick something you've already looked at on the chart.",
    how: ["Find the Symbol box in the highlighted area of the order ticket.", "Click it and type a symbol, for example AAPL or EUR_USD, or pick one from the list that appears.", "Check the name in the Market snapshot card matches what you meant."],
  },
  {
    title: "Buy or sell",
    why: "Buy if you think the price will rise. Sell if you think it will fall.",
    how: ["Find the two buttons at the top of the ticket: Buy / Long and Sell / Short.", "Click the one that matches your idea. The selected button lights up."],
  },
  {
    title: "Choose a small size",
    why: "Your first trade is practice, so keep it small. The goal is to learn the steps, not to win big.",
    how: ["Find the Quantity box.", "Type a small number, such as 1.", "Look at the Estimated value line below. It shows roughly how much this order is worth."],
  },
  {
    title: "Add a stop loss and take profit",
    why: "A stop loss sets a trigger for an exit; it does not guarantee an execution price or limit your loss. A take profit sets a target. Decide both before you enter.",
    how: ["Find the Stop loss and Take profit boxes.", "Type your own prices, or press Ask Zuri to fill these and I'll suggest them from recent price swings.", "For a Buy, the stop sits below the current price and the target above. For a Sell it's the other way round."],
  },
  {
    title: "Confirm and send it yourself",
    why: "I never place trades for you. You press the final button.",
    how: ["Read your order once more: symbol, side, quantity, stop and target.", "Tick the box that says I confirm this order.", "Click the big Buy or Sell button at the bottom of the ticket.", "Wait for the green message that says the order was sent."],
  },
] as const;

export function FirstTradeCoach({ step, onStep, onExit, placed, onFinish, note, onAskLevels, levelsBusy }: {
  step: number;
  onStep: (step: number) => void;
  onExit: () => void;
  placed: boolean;
  onFinish: () => void;
  note: string;
  onAskLevels: () => void;
  levelsBusy: boolean;
}) {
  if (placed) {
    return (
      <section className="content-card trade-coach coach-done" data-zuri-target="trade-coach">
        <div className="trade-coach-zuri"><ZuriMascot mood="idle" size={72} emote="🎉" /></div>
        <div className="trade-coach-body">
          <span className="small-label">FIRST ORDER · SENT</span>
          <h2>Your order was submitted</h2>
          <p>An accepted order may still be pending or only partly filled. Check your broker&apos;s order and fill history before recording it as a trade.</p>
          <div className="trade-coach-actions"><button className="solid-button" onClick={onFinish}>Finish</button></div>
        </div>
      </section>
    );
  }
  const current = STEPS[Math.min(step, STEPS.length - 1)];
  const last = step >= STEPS.length - 1;
  return (
    <section className="content-card trade-coach" data-zuri-target="trade-coach">
      <div className="trade-coach-zuri"><ZuriMascot mood="talking" size={72} emote="👉" /></div>
      <div className="trade-coach-body">
        <div className="trade-coach-head">
          <span className="small-label">YOUR FIRST TRADE · STEP {step + 1} OF {STEPS.length}</span>
          <button className="text-action" onClick={onExit}>Hide guide</button>
        </div>
        <div className="trade-coach-dots" aria-hidden="true">{STEPS.map((item, index) => <i key={item.title} className={index < step ? "done" : index === step ? "now" : ""} />)}</div>
        <h2>{current.title}</h2>
        <p>{current.why}</p>
        <ol>{current.how.map((line) => <li key={line}>{line}</li>)}</ol>
        {note && <p className="trade-coach-note" role="status">{note}</p>}
        <div className="trade-coach-actions">
          {step > 0 && <button className="outline-button" onClick={() => onStep(step - 1)}>← Back</button>}
          {step === 3 && <button className="outline-button" onClick={onAskLevels} disabled={levelsBusy}>{levelsBusy ? "Zuri is checking…" : "Ask Zuri to fill these"}</button>}
          {!last && <button className="solid-button" onClick={() => onStep(step + 1)}>I&apos;ve done this, next →</button>}
          {last && <small className="muted">I&apos;ll stay here until your order is submitted.</small>}
        </div>
      </div>
    </section>
  );
}

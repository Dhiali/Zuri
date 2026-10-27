"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ZuriMascot, type Section, type ZuriExpression } from "./zuri-journey";
import type { ZuriJourney } from "./user-data";

type Topic = "market-strip" | "next-step";
type Msg = { role: "user" | "assistant"; content: string };
type NextStep = { id: string; title: string } | null;
type Action = { label: string; section?: Section; href?: string };

const stepActions: Record<string, Action> = {
  "broker-account": { label: "Open Alpaca sign-up", href: "https://app.alpaca.markets/signup" },
  "broker-keys": { label: "Open Alpaca paper dashboard", href: "https://app.alpaca.markets/paper/dashboard/overview" },
  "broker-link": { label: "Take me to Settings → Broker", section: "Settings" },
  "first-trade": { label: "Open Trade", section: "Trade" },
  "first-journal": { label: "Open Journal", section: "Journal" },
  "risk-rules": { label: "Open Settings", section: "Settings" },
};

const unique = (items: string[]) => [...new Set(items)];

export function ZuriGuide({ accessToken, section, journey, onJourney, setSection }: {
  accessToken: string;
  section: Section;
  journey: ZuriJourney;
  onJourney: (next: ZuriJourney) => void;
  setSection: (section: Section) => void;
}) {
  const [topic, setTopic] = useState<Topic>(journey.completed_steps.includes("seen:market-strip") ? "next-step" : "market-strip");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [nextStep, setNextStep] = useState<NextStep>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const journeyRef = useRef(journey);
  const listRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);

  useLayoutEffect(() => {
    const measure = () => {
      const box = document.querySelector(".market-strip")?.getBoundingClientRect();
      setRect(box ? { left: box.left - 12, top: box.top - 8, width: box.width + 24, height: box.height + 16 } : { left: 16, top: 8, width: 320, height: 40 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const ask = async (currentTopic: Topic, conversation: Msg[]) => {
    const id = ++requestId.current;
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const strip = document.querySelector(".market-strip .market-open")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const response = await fetch(`${backendUrl}/api/zuri/guide`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ topic: currentTopic, messages: conversation, strip_text: strip, section }),
      });
      if (!response.ok) throw new Error("guide failed");
      const data = (await response.json()) as { message: string; next_step: NextStep };
      if (id !== requestId.current) return;
      setMessages([...conversation, { role: "assistant", content: data.message }]);
      setNextStep(data.next_step);
      if (conversation.length === 0) setTyped(0);
      else setTyped(data.message.length);
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void ask(topic, []), 0);
    return () => window.clearTimeout(timer);
    // Load once per topic; the token and section are read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  const last = messages[messages.length - 1];
  const firstReply = messages.length === 1;
  useEffect(() => {
    if (!firstReply || !last) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = window.requestAnimationFrame(() => setTyped(last.content.length));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setInterval(() => setTyped((current) => Math.min(current + 2, last.content.length)), 20);
    return () => window.clearInterval(timer);
  }, [firstReply, last]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, loading, typed]);

  const save = (marks: string[], keepAsked?: string) => {
    const current = journeyRef.current;
    const asked = current.completed_steps.filter((mark) => mark.startsWith("asked:"));
    const rest = current.completed_steps.filter((mark) => !mark.startsWith("asked:"));
    const nextAsked = keepAsked ? [...asked, `asked:${keepAsked.slice(0, 90)}`].slice(-8) : asked;
    onJourney({ ...current, completed_steps: unique([...rest, ...marks, ...nextAsked]) });
  };

  const send = () => {
    const text = draft.trim();
    if (!text || loading) return;
    const conversation = [...messages, { role: "user" as const, content: text }];
    setMessages(conversation);
    setDraft("");
    setLoading(true);
    save([], text);
    void ask(topic, conversation);
  };

  const skip = () => save(["guide:skipped"]);
  const nextTopic = () => {
    save(["seen:market-strip"]);
    setMessages([]);
    setChatOpen(false);
    setLoading(true);
    setTopic("next-step");
  };
  const act = (action: Action | undefined) => {
    save(["seen:market-strip", "seen:next-step", "guide:done"]);
    if (action?.section) setSection(action.section);
    if (action?.href) window.open(action.href, "_blank", "noopener,noreferrer");
  };

  const action = nextStep ? stepActions[nextStep.id] : undefined;
  const expression: ZuriExpression = loading ? "thinking" : failed ? "sad" : "happy";
  const shownText = (message: Msg, index: number) => (index === 0 && firstReply && index === messages.length - 1 ? message.content.slice(0, typed) : message.content);
  const typing = firstReply && !!last && typed < last.content.length;
  const cardTop = rect ? rect.top + rect.height + 14 : 80;
  const cardLeft = rect ? Math.max(12, Math.min(rect.left, window.innerWidth - 412)) : 12;

  return (
    <div className="zuri-guide" role="dialog" aria-modal="true" aria-label="Zuri guide">
      <div className="zuri-guide-blocker" />
      {rect && <div className="zuri-spotlight" style={rect} />}
      <div className="zuri-guide-card" style={{ top: cardTop, left: cardLeft }}>
        <div className="zuri-guide-head">
          <ZuriMascot size={44} expression={expression} />
          <div>
            <span className="zuri-welcome-name">Zuri · {topic === "market-strip" ? "The top bar" : "Your next step"}</span>
            {nextStep && topic === "next-step" && <b className="zuri-guide-step">{nextStep.title}</b>}
          </div>
          <button type="button" className="zuri-skip zuri-guide-skip" onClick={skip}>Skip</button>
        </div>
        <div className="zuri-guide-body" ref={listRef} aria-live="polite">
          {messages.map((message, index) => (
            <p key={index} className={message.role === "user" ? "zuri-guide-user" : "zuri-guide-zuri"}>{shownText(message, index)}{typing && index === messages.length - 1 && <span className="iv-caret" aria-hidden="true" />}</p>
          ))}
          {loading && <p className="zuri-guide-zuri"><span className="iv-caret" aria-hidden="true" /></p>}
          {failed && <p className="zuri-guide-zuri">I couldn’t reach my brain just now. You can try again, or skip for now.</p>}
        </div>
        {chatOpen && (
          <form className="zuri-guide-form" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Zuri anything about this…" maxLength={400} autoFocus aria-label="Ask Zuri" />
            <button type="submit" className="solid-button" disabled={!draft.trim() || loading}>Send</button>
          </form>
        )}
        <div className="zuri-welcome-actions">
          {failed && <button type="button" className="outline-button" onClick={() => { setFailed(false); setLoading(true); void ask(topic, messages.filter((m, i) => !(i === messages.length - 1 && m.role === "assistant"))); }}>Try again</button>}
          {!failed && !chatOpen && <button type="button" className="outline-button" disabled={loading || typing} onClick={() => setChatOpen(true)}>Ask a question</button>}
          {topic === "market-strip" && <button type="button" className="solid-button" disabled={loading || typing} onClick={nextTopic}>{chatOpen ? "I’m good, what’s next?" : "Got it, what’s next?"}</button>}
          {topic === "next-step" && action && <button type="button" className="solid-button" disabled={loading || typing} onClick={() => act(action)}>{action.label}</button>}
          {topic === "next-step" && !action && <button type="button" className="solid-button" disabled={loading} onClick={() => act(undefined)}>Done</button>}
          {topic === "next-step" && <button type="button" className="zuri-skip" onClick={() => act(undefined)}>Not now</button>}
        </div>
      </div>
    </div>
  );
}

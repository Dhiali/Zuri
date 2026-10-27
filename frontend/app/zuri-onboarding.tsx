"use client";

import { useEffect, useRef, useState } from "react";
import { backendUrl } from "./linked-account";
import { ZuriMascot, type ZuriExpression } from "./zuri-journey";

export type Involvement = "side_by_side" | "occasional" | "on_demand";
export type TourChoice = "none" | "quick" | "detailed";
export type OnboardingResult = { tour: TourChoice; involvement: Involvement; seeScreen: boolean; actOnScreen: boolean; marketLevels: Record<string, string> };
export type MarketLayout = { mode: "list" | "tabs" | "sections"; focus: string | null; markets: { market: string; level: string; detail: "simple" | "full"; collapsed: boolean }[] };
const LAYOUT_KEY = "zuri.layout";
export const loadLayout = (): MarketLayout | null => {
  try { return JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? "null") as MarketLayout | null; } catch { return null; }
};
export const saveLayout = (layout: MarketLayout | null) => (layout ? window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) : window.localStorage.removeItem(LAYOUT_KEY));

type Msg = { role: "user" | "assistant"; content: string };
type Stage = "chat" | "roadmap" | "setup";
type RoadmapStep = { title: string; detail: string };

const INVOLVEMENT_KEY = "zuri.involvement";
export const loadInvolvement = (): Involvement => {
  const stored = typeof window === "undefined" ? null : window.localStorage.getItem(INVOLVEMENT_KEY);
  return stored === "occasional" || stored === "on_demand" ? stored : "side_by_side";
};
export const saveInvolvement = (value: Involvement) => window.localStorage.setItem(INVOLVEMENT_KEY, value);

const tours: { id: TourChoice; title: string; text: string }[] = [
  { id: "detailed", title: "Walk me through everything", text: "A full guided tour of every section, including opening a free practice broker account and linking it to Zuri. I take over the screen and explain each control." },
  { id: "quick", title: "A quick look around", text: "A short tour of the main sections, about a minute." },
  { id: "none", title: "I'll explore on my own", text: "No tour. Ask me whenever you need something." },
];

const involvements: { id: Involvement; title: string; text: string }[] = [
  { id: "side_by_side", title: "Side-by-side buddy", text: "I stay close, comment on what you do and check in often." },
  { id: "occasional", title: "Occasional buddy", text: "I step in for the moments that matter and otherwise leave you to it." },
  { id: "on_demand", title: "Need-to-know buddy", text: "I stay quiet unless you ask or something important needs your attention." },
];

async function call<T>(token: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const info = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new Error(response.status === 429 && typeof info?.detail === "string" ? info.detail : "request failed");
  }
  return response.json() as Promise<T>;
}

export function ZuriOnboarding({ accessToken, initialSee, initialAct, onFinish, onSkip }: {
  accessToken: string;
  initialSee: boolean;
  initialAct: boolean;
  onFinish: (result: OnboardingResult) => Promise<void>;
  onSkip: () => void;
}) {
  const [stage, setStage] = useState<Stage>("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [unsure, setUnsure] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failNote, setFailNote] = useState("");
  const noteFor = (error: unknown) => (error instanceof Error && error.message !== "request failed" ? error.message : "");
  const [roadmap, setRoadmap] = useState<{ message: string; steps: RoadmapStep[]; levels: Record<string, string> } | null>(null);
  const [tour, setTour] = useState<TourChoice | null>(null);
  const [involvement, setInvolvement] = useState<Involvement | null>(null);
  const [seeScreen, setSeeScreen] = useState(initialSee);
  const [actOnScreen, setActOnScreen] = useState(initialAct);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const open = () => {
    setLoading(true);
    setFailed(false);
    call<{ message: string }>(accessToken, "/api/zuri/onboarding", { stage: "open", messages: [] })
      .then((data) => setMessages([{ role: "assistant", content: data.message }]))
      .catch((error: unknown) => { setFailNote(noteFor(error)); setFailed(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    open();
    // The conversation opens once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, unsure]);

  const buildRoadmap = async (conversation: Msg[]) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await call<{ message: string; roadmap: RoadmapStep[]; market_levels?: Record<string, string> }>(accessToken, "/api/zuri/onboarding", { stage: "roadmap", messages: conversation });
      setRoadmap({ message: data.message, steps: data.roadmap, levels: data.market_levels ?? {} });
      setStage("roadmap");
    } catch (error) {
      setFailNote(noteFor(error));
      setFailed(true);
      setUnsure(true);
    } finally {
      setLoading(false);
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    const conversation: Msg[] = [...messages, { role: "user", content }];
    setMessages(conversation);
    setDraft("");
    setUnsure(false);
    setLoading(true);
    setFailed(false);
    try {
      const data = await call<{ reply: string; status: "continue" | "unsure" | "done" }>(accessToken, "/api/zuri/onboarding", { stage: "chat", messages: conversation });
      const next: Msg[] = [...conversation, { role: "assistant", content: data.reply }];
      setMessages(next);
      if (data.status === "done") await buildRoadmap(next);
      else {
        setUnsure(data.status === "unsure");
        setLoading(false);
      }
    } catch (error) {
      setFailNote(noteFor(error));
      setMessages(messages);
      setDraft(content);
      setFailed(true);
      setLoading(false);
    }
  };

  const look: ZuriExpression = loading ? "thinking" : failed ? "sad" : "happy";
  const ready = tour !== null && involvement !== null;

  return (
    <div className="zuri-welcome zuri-onb-backdrop" role="dialog" aria-modal="true" aria-label="Meet Zuri">
      <section className="zuri-onb">
        <div className="zuri-onb-head">
          <ZuriMascot size={72} expression={look} />
          <div>
            <span className="zuri-welcome-name">Zuri · Your trading buddy</span>
            <small>{stage === "chat" ? "Getting to know you" : stage === "roadmap" ? "Your roadmap" : "Setting things up your way"}</small>
          </div>
          <button type="button" className="zuri-skip" onClick={onSkip}>Skip for now</button>
        </div>

        {stage === "chat" && (
          <>
            <div className="zuri-onb-thread" ref={listRef} aria-live="polite">
              {messages.map((message, index) => <p key={index} className={`zuri-onb-msg ${message.role}`}>{message.content}</p>)}
              {loading && <p className="zuri-onb-msg assistant"><span className="iv-caret" aria-hidden="true" /></p>}
              {failed && <p className="zuri-onb-msg error" role="alert">{failNote || "I couldn't reach my brain just now."} {messages.length === 0 ? <button type="button" className="zuri-skip" onClick={open}>Try again</button> : "Your message is still in the box, try sending it again."}</p>}
            </div>
            {unsure && !loading && (
              <div className="zuri-onb-choices" role="group" aria-label="Do you want to say more?">
                <button type="button" className="outline-button" onClick={() => { setUnsure(false); document.getElementById("zuri-onb-input")?.focus(); }}>I want to say more</button>
                <button type="button" className="solid-button" onClick={() => void buildRoadmap(messages)}>We can move on</button>
              </div>
            )}
            {messages.length > 0 && (
              <form className="zuri-onb-form" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
                <input id="zuri-onb-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell Zuri anything about you and your trading…" maxLength={1000} autoComplete="off" disabled={loading} />
                <button type="submit" className="solid-button" disabled={loading || !draft.trim()}>Send</button>
              </form>
            )}
          </>
        )}

        {stage === "roadmap" && roadmap && (
          <div className="zuri-onb-body">
            <p className="zuri-onb-msg assistant">{roadmap.message}</p>
            <ol className="zuri-onb-roadmap">
              {roadmap.steps.map((step) => <li key={step.title}><b>{step.title}</b><span>{step.detail}</span></li>)}
            </ol>
            <div className="zuri-onb-choices">
              <button type="button" className="solid-button" onClick={() => setStage("setup")}>Let&apos;s set up how we work together</button>
            </div>
          </div>
        )}

        {stage === "setup" && (
          <div className="zuri-onb-body">
            <fieldset>
              <legend>How would you like to get started?</legend>
              <div className="zuri-onb-grid">{tours.map((item) => <button key={item.id} type="button" aria-pressed={tour === item.id} className={tour === item.id ? "zuri-onb-card selected" : "zuri-onb-card"} onClick={() => setTour(item.id)}><b>{item.title}</b><span>{item.text}</span></button>)}</div>
            </fieldset>
            <fieldset>
              <legend>How involved should I be?</legend>
              <div className="zuri-onb-grid">{involvements.map((item) => <button key={item.id} type="button" aria-pressed={involvement === item.id} className={involvement === item.id ? "zuri-onb-card selected" : "zuri-onb-card"} onClick={() => setInvolvement(item.id)}><b>{item.title}</b><span>{item.text}</span></button>)}</div>
            </fieldset>
            <fieldset>
              <legend>What may I do on your screen?</legend>
              <label className="zuri-onb-toggle"><input type="checkbox" checked={seeScreen} onChange={(event) => setSeeScreen(event.target.checked)} /><span><b>Always let Zuri see my screen</b><small>I can read the chart, positions and news you are looking at.</small></span></label>
              <label className="zuri-onb-toggle"><input type="checkbox" checked={actOnScreen} onChange={(event) => setActOnScreen(event.target.checked)} /><span><b>Let Zuri act for me</b><small>I can open charts, set limits and take you through setups. Every action still needs your OK, and trades need your own confirm click.</small></span></label>
              <small className="zuri-onb-note">You can change all of this any time in Settings.</small>
            </fieldset>
            <div className="zuri-onb-choices">
              <button type="button" className="solid-button" disabled={!ready || saving} onClick={async () => {
                if (!tour || !involvement) return;
                setSaving(true);
                try { await onFinish({ tour, involvement, seeScreen, actOnScreen, marketLevels: roadmap?.levels ?? {} }); } finally { setSaving(false); }
              }}>{saving ? "Setting up…" : tour === "none" ? "Take me to my dashboard" : "Start my tour"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

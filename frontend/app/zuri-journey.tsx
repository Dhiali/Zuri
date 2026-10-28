"use client";

export type Section = "Charts" | "Dashboard" | "Trade" | "History" | "Journal" | "Settings";
type Mood = "idle" | "talking" | "celebrating";

export type ZuriExpression = "neutral" | "happy" | "thinking" | "surprised" | "sad";
export type ZuriGesture = "nod" | "shake";

function expressionFor(mood: Mood, emote?: string): ZuriExpression {
  if (mood === "celebrating" || emote === "ðŸŽ‰" || emote === "âœ…") return "happy";
  if (emote === "ðŸ¤”" || emote === "ðŸ§" || mood === "talking") return "thinking";
  if (emote === "ðŸ’ª") return "sad";
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


"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../supabase";

type VerificationState = "checking" | "confirmed" | "error";

export default function EmailVerifiedPage() {
  const [state, setState] = useState<VerificationState>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    void Promise.resolve().then(async () => {
      if (!supabase) throw new Error("Email verification is unavailable because Supabase is not configured.");
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session?.user.email_confirmed_at) {
        throw new Error("This verification link may have expired or already been used. Return to Zuri and sign in, or request a new confirmation email.");
      }
    }).then(() => {
      if (!active) return;
      setState("confirmed");
    }).catch((sessionError: unknown) => {
      if (!active) return;
      setError(sessionError instanceof Error ? sessionError.message : "We couldn’t verify your email. Please try again.");
      setState("error");
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="email-verified-shell">
      <section className="email-verified-card" aria-live="polite">
        <span className="email-verified-mark" aria-hidden="true">{state === "confirmed" ? "✓" : "z"}</span>
        {state === "checking" ? (
          <>
            <span className="auth-card-kicker">ACCOUNT VERIFICATION</span>
            <h1>Checking your email…</h1>
            <p>Please wait while we confirm your email address.</p>
          </>
        ) : state === "confirmed" ? (
          <>
            <span className="auth-card-kicker">EMAIL CONFIRMED</span>
            <h1>You’re all set.</h1>
            <p>Your email address has been verified. You can close this tab and return to the Zuri tab where you started.</p>
            <span className="email-verified-hint">Welcome to Zuri Markets · Educational demo workspace</span>
          </>
        ) : (
          <>
            <span className="auth-card-kicker">VERIFICATION NOT COMPLETE</span>
            <h1>We couldn’t verify your email.</h1>
            <p>{error}</p>
            <Link className="email-verified-link" href="/">Return to Zuri</Link>
          </>
        )}
      </section>
    </main>
  );
}

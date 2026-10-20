"use client";

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "./supabase";

type AuthStatus = "loading" | "welcome" | "sign-in" | "sign-up" | "onboarding" | "workspace" | "reset-password";
type Experience = "New to trading" | "Learning the basics" | "Experienced";
type Market = "Stocks" | "Crypto" | "Forex" | "Commodities";

type AuthContextValue = {
  session: Session | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useZuriAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useZuriAuth must be used inside ZuriAuthGate.");
  return context;
}

function statusForSession(session: Session | null): AuthStatus {
  if (!session) return "welcome";
  return session.user.user_metadata.onboarding_completed === true ? "workspace" : "onboarding";
}

export function ZuriAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "welcome");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [experience, setExperience] = useState<Experience>("New to trading");
  const [markets, setMarkets] = useState<Market[]>([]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let active = true;
    let authEventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      authEventReceived = true;
      setSession(nextSession);
      setStatus(event === "PASSWORD_RECOVERY" ? "reset-password" : statusForSession(nextSession));
      setError("");
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authEventReceived) return;
      if (sessionError) {
        setError(sessionError.message);
        setStatus("welcome");
        return;
      }
      setSession(data.session);
      setStatus(statusForSession(data.session));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const contextValue = useMemo<AuthContextValue>(() => ({
    session,
    signOut: async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured yet.");
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setSession(null);
      setStatus("welcome");
    },
  }), [session]);

  const switchStatus = (next: AuthStatus) => {
    setError("");
    setMessage("");
    setPassword("");
    setStatus(next);
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Connect Zuri to Supabase first. Add the two Supabase values to frontend/.env.local and backend/.env, then restart the apps.");
      return;
    }

    setBusy(true);
    try {
      if (status === "sign-up") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { onboarding_completed: false },
          },
        });
        if (authError) throw authError;
        if (data.session) {
          setSession(data.session);
          setStatus("onboarding");
        } else {
          setMessage("Check your inbox for a confirmation link. Once your email is verified, you can sign in and finish setting up your desk.");
          setStatus("sign-in");
        }
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        setSession(data.session);
        setStatus(statusForSession(data.session));
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Unable to complete sign-in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const sendPasswordReset = async () => {
    setError("");
    setMessage("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Connect Zuri to Supabase first. Add the two Supabase values to frontend/.env.local and backend/.env, then restart the apps.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }

    setBusy(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setMessage("Password reset link sent. Check your email to choose a new password.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to send a reset link.");
    } finally {
      setBusy(false);
    }
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const nextSession = data.user ? (await supabase.auth.getSession()).data.session : null;
      setSession(nextSession);
      setStatus(statusForSession(nextSession));
      setMessage("Password updated.");
      setPassword("");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update your password.");
    } finally {
      setBusy(false);
    }
  };

  const finishOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (markets.length === 0) {
      setError("Choose at least one market to personalize your workspace.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setBusy(true);
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: {
          display_name: name.trim(),
          trading_experience: experience,
          primary_markets: markets,
          onboarding_completed: true,
        },
      });
      if (updateError) throw updateError;
      const nextSession = data.user ? (await supabase.auth.getSession()).data.session : null;
      setSession(nextSession);
      setStatus(statusForSession(nextSession));
    } catch (onboardingError) {
      setError(onboardingError instanceof Error ? onboardingError.message : "Unable to save your preferences.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {status === "workspace" ? children : status === "loading" ? (
        <main className="auth-loading" aria-label="Loading Zuri"><span className="auth-mark">z</span><span>Getting your desk ready…</span></main>
      ) : (
        <main className="auth-shell">
          <header className="auth-topbar">
            <Link className="auth-brand" href="/" aria-label="Zuri home"><span className="auth-mark">z</span><span>zuri<span>.</span></span></Link>
            {status === "welcome" ? (
              <div className="auth-top-actions"><span>Already have an account?</span><button type="button" className="auth-text-button" onClick={() => switchStatus("sign-in")}>Sign in</button></div>
            ) : (
              <button type="button" className="auth-text-button" onClick={() => switchStatus("welcome")}>Back to home</button>
            )}
          </header>

          <div className={`auth-content ${status === "welcome" ? "welcome-content" : ""}`}>
            <section className="auth-story">
              <span className="auth-eyebrow"><i /> YOUR MARKET, IN FOCUS</span>
              <h1>{status === "welcome" ? <>Trade with a little more <em>clarity.</em></> : status === "onboarding" ? <>A desk that starts with <em>you.</em></> : <>A calmer way to meet the <em>markets.</em></>}</h1>
              <p className="auth-story-copy">A thoughtful trading workspace for charts, plans, and perspective. Start with a demo desk, build better habits, and keep risk in view.</p>
              <div className="auth-preview" aria-label="Example Zuri market chart">
                <div className="auth-preview-top"><div><span className="auth-preview-symbol">BTC</span><span>Bitcoin / U.S. Dollar</span></div><span className="auth-demo-badge"><i /> DEMO MARKET</span></div>
                <div className="auth-preview-price">$85,890 <span>+1.22%</span></div>
                <svg className="auth-preview-chart" viewBox="0 0 520 126" role="img" aria-label="Illustrative market chart">
                  <defs><linearGradient id="auth-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#b99aff" stopOpacity=".24" /><stop offset="100%" stopColor="#b99aff" stopOpacity="0" /></linearGradient></defs>
                  <path d="M0 101 C35 89 46 93 75 79 S119 85 148 67 S187 76 217 60 S255 72 282 48 S328 56 355 40 S397 50 425 26 S478 36 520 12 V126 H0Z" fill="url(#auth-chart-fill)" />
                  <path d="M0 101 C35 89 46 93 75 79 S119 85 148 67 S187 76 217 60 S255 72 282 48 S328 56 355 40 S397 50 425 26 S478 36 520 12" fill="none" stroke="#c3a8ff" strokeWidth="2.5" />
                  <path d="M0 122 H520 M0 82 H520 M0 42 H520" stroke="#ffffff" strokeOpacity=".07" strokeDasharray="3 6" />
                </svg>
                <div className="auth-preview-foot"><span>Plan first. Decide with care.</span><span>SIMULATED DATA</span></div>
              </div>
              <div className="auth-promise"><span>✳</span><p><b>Built for better decisions.</b><br />Not louder signals. Not promises. Just a clear place to think.</p></div>
            </section>

            <section className={`auth-card ${status === "welcome" ? "auth-welcome-card" : ""}`}>
              {status === "welcome" && (
                <>
                  <span className="auth-card-kicker">YOUR TRADING DESK, REIMAGINED</span>
                  <h2>Make room for a better process.</h2>
                  <p>Bring your market watch, trade plans, and AI context into one calmer workspace.</p>
                  <button type="button" className="auth-submit" onClick={() => switchStatus("sign-up")}>Create your account <span>→</span></button>
                  <button type="button" className="auth-secondary" onClick={() => switchStatus("sign-in")}>I already have an account</button>
                  {!isSupabaseConfigured && <div className="auth-setup-note"><b>One quick setup step remains</b><span>Connect Zuri to Supabase to enable secure accounts. See the setup steps in the frontend README.</span></div>}
                  <div className="auth-fineprint">By continuing, you agree to use Zuri as an educational demo workspace. Market data shown here may be simulated.</div>
                </>
              )}

              {(status === "sign-in" || status === "sign-up") && (
                <>
                  <span className="auth-card-kicker">{status === "sign-up" ? "A GOOD PLACE TO BEGIN" : "WELCOME BACK"}</span>
                  <h2>{status === "sign-up" ? "Create your account" : "Sign in to Zuri"}</h2>
                  <p>{status === "sign-up" ? "Your personal trading workspace is a few steps away." : "Pick up where you left off."}</p>
                  {message && <div className="auth-message" role="status">{message}</div>}
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <form className="auth-form" onSubmit={handleAuth}>
                    <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
                    <label>Password<input type="password" autoComplete={status === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={status === "sign-up" ? "At least 8 characters" : "Your password"} minLength={status === "sign-up" ? 8 : undefined} required /></label>
                    {status === "sign-in" && <button type="button" className="auth-forgot" disabled={busy} onClick={() => void sendPasswordReset()}>Forgot password?</button>}
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Please wait…" : status === "sign-up" ? "Create account" : "Sign in"} <span>→</span></button>
                  </form>
                  <div className="auth-switch">{status === "sign-up" ? "Already have an account?" : "New to Zuri?"} <button type="button" onClick={() => switchStatus(status === "sign-up" ? "sign-in" : "sign-up")}>{status === "sign-up" ? "Sign in" : "Create an account"}</button></div>
                  <div className="auth-fineprint">Your account is managed securely by Supabase. Zuri never stores your password.</div>
                </>
              )}

              {status === "reset-password" && (
                <>
                  <span className="auth-card-kicker">ACCOUNT SECURITY</span>
                  <h2>Choose a new password</h2>
                  <p>Make it at least 8 characters. You can sign in with it next time.</p>
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <form className="auth-form" onSubmit={updatePassword}>
                    <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Updating…" : "Update password"} <span>→</span></button>
                  </form>
                </>
              )}

              {status === "onboarding" && (
                <>
                  <span className="auth-card-kicker">YOUR FIRST 60 SECONDS</span>
                  <h2>Let’s set up your desk.</h2>
                  <p>A couple of quick choices help tailor your starting workspace.</p>
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <form className="auth-form onboarding-form" onSubmit={finishOnboarding}>
                    <label>What should we call you?<input type="text" autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name (optional)" maxLength={60} /></label>
                    <fieldset><legend>Where are you in your trading journey?</legend><div className="auth-choice-grid">{(["New to trading", "Learning the basics", "Experienced"] as Experience[]).map((option) => <button key={option} type="button" className={experience === option ? "auth-choice selected" : "auth-choice"} onClick={() => setExperience(option)}>{option}</button>)}</div></fieldset>
                    <fieldset><legend>Which markets interest you? <small>Choose at least one</small></legend><div className="auth-choice-grid markets">{(["Stocks", "Crypto", "Forex", "Commodities"] as Market[]).map((market) => <button key={market} type="button" aria-pressed={markets.includes(market)} className={markets.includes(market) ? "auth-choice selected" : "auth-choice"} onClick={() => setMarkets((current) => current.includes(market) ? current.filter((item) => item !== market) : [...current, market])}>{market}</button>)}</div></fieldset>
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Saving your desk…" : "Open my trading desk"} <span>→</span></button>
                  </form>
                  <div className="auth-fineprint">Your preferences are saved with your account and can be changed later.</div>
                </>
              )}
            </section>
          </div>
          <footer className="auth-footer"><span>© 2026 Zuri Markets</span><span>Educational demo · Not financial advice</span><span>Simulated market data</span></footer>
        </main>
      )}
    </AuthContext.Provider>
  );
}

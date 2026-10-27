"use client";

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "./supabase";
import { saveUserProfile } from "./user-data";
import { IntroVisual } from "./intro-visuals";

type AuthStatus = "loading" | "intro" | "welcome" | "sign-in" | "sign-up" | "set-password" | "verify-email" | "onboarding" | "workspace" | "reset-password";
type Experience = "New to trading" | "Learning the basics" | "Experienced";
type Market = "Stocks" | "Crypto" | "Forex" | "Commodities";
type SocialProvider = "google";

const MIN_SPLASH_DURATION_MS = 3200;
const INTRO_COMPLETED_STORAGE_KEY = "zuri-product-intro-completed";
const EMAIL_LINK_REQUIRED_FROM = Date.UTC(2026, 9, 27);
const introSteps = [
  {
    eyebrow: "YOUR TRADING EXPERT",
    title: "Ask Zuri, your trading expert assistant.",
    body: "Any question about markets, any time. Get a clear answer in seconds.",
    note: "",
  },
  {
    eyebrow: "PRACTICE WITHOUT RISK",
    title: "Test every idea before it costs you.",
    body: "Run any strategy in a $10,000 practice account and see the result before real money is involved.",
    note: "",
  },
  {
    eyebrow: "YOUR AI TRADING PARTNER",
    title: "From sign-up to your first trade in minutes.",
    body: "Your practice desk, your expert assistant and your first plan are all waiting. Free to start.",
    note: "",
  },
];

type AuthContextValue = {
  session: Session | null;
  signOut: () => Promise<void>;
  updateEmail: (email: string) => Promise<void>;
  sendPasswordChangeEmail: () => Promise<string>;
  updateDisplayName: (displayName: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function signedOutStatus(): AuthStatus {
  return getIntroCompletedSnapshot() ? "sign-in" : "intro";
}

function subscribeToIntro(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("zuri-product-intro-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("zuri-product-intro-change", onStoreChange);
  };
}

function getIntroCompletedSnapshot() {
  try {
    return window.localStorage.getItem(INTRO_COMPLETED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerIntroSnapshot() {
  return false;
}

// Anyone who has ever held a session already has an account, so the pre-sign-up intro is never shown to them again on this browser.
function markKnownUser(session: Session | null) {
  if (!session) return;
  try {
    if (window.localStorage.getItem(INTRO_COMPLETED_STORAGE_KEY) !== "true") {
      window.localStorage.setItem(INTRO_COMPLETED_STORAGE_KEY, "true");
      window.dispatchEvent(new Event("zuri-product-intro-change"));
    }
  } catch {
    // Storage unavailable: the intro may show again, which is harmless.
  }
}

export function useZuriAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useZuriAuth must be used inside ZuriAuthGate.");
  return context;
}

function statusForSession(session: Session | null): AuthStatus {
  if (!session) return signedOutStatus();
  const providers = session.user.app_metadata.providers;
  const usedGoogle = Array.isArray(providers)
    ? providers.includes("google")
    : session.user.app_metadata.provider === "google";
  if (usedGoogle && session.user.user_metadata.password_created !== true) return "set-password";
  // New Google accounts must confirm their email by link. The flag lives in app_metadata, which only the backend can write.
  if (usedGoogle && session.user.app_metadata.email_link_verified !== true && Date.parse(session.user.created_at) >= EMAIL_LINK_REQUIRED_FROM) return "verify-email";
  return session.user.user_metadata.onboarding_completed === true ? "workspace" : "onboarding";
}

function getAuthErrorMessage(authError: unknown, currentStatus: AuthStatus) {
  const message = authError instanceof Error ? authError.message : "Unable to complete sign-in. Please try again.";
  if (currentStatus === "sign-up" && message.toLowerCase().includes("error sending confirmation email")) {
    const diagnostics: string[] = [];
    if (authError instanceof Error && "status" in authError && typeof authError.status === "number") {
      diagnostics.push(`HTTP ${authError.status}`);
    }
    if (authError instanceof Error && "code" in authError && typeof authError.code === "string") {
      diagnostics.push(`code: ${authError.code}`);
    }
    const diagnosticText = diagnostics.length > 0 ? ` (${diagnostics.join(", ")})` : "";
    return `Supabase could not send the confirmation email${diagnosticText}. Check Supabase Dashboard → Logs → Auth for the SMTP provider's detailed rejection. If using Gmail SMTP, verify that custom SMTP is enabled and the host, port, TLS setting, full email username, and Google app password are correct. You can also use Continue with Google.`;
  }
  return message;
}

export function ZuriAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "intro");
  const introCompleted = useSyncExternalStore(subscribeToIntro, getIntroCompletedSnapshot, getServerIntroSnapshot);
  const visibleStatus = status === "intro" && introCompleted ? "sign-in" : status;
  const [splashReady, setSplashReady] = useState(!isSupabaseConfigured);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeProvider, setActiveProvider] = useState<SocialProvider | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [confirmAccountPassword, setConfirmAccountPassword] = useState("");
  const [name, setName] = useState("");
  const [introStep, setIntroStep] = useState(0);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsUnsure, setMarketsUnsure] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const timeout = window.setTimeout(() => setSplashReady(true), MIN_SPLASH_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let active = true;
    let authEventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      authEventReceived = true;
      markKnownUser(nextSession);
      setSession(nextSession);
      setStatus(event === "PASSWORD_RECOVERY" ? "reset-password" : statusForSession(nextSession));
      setError("");
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authEventReceived) return;
      if (sessionError) {
        if (/refresh token/i.test(sessionError.message)) {
          void supabase.auth.signOut({ scope: "local" });
          setSession(null);
        } else {
          setError(sessionError.message);
        }
        setStatus(signedOutStatus());
        return;
      }
      markKnownUser(data.session);
      setSession(data.session);
      setStatus(statusForSession(data.session));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const sendVerificationEmail = async () => {
    const supabase = getSupabaseBrowserClient();
    const address = session?.user.email;
    if (!supabase || !address) return;
    setBusy(true);
    setError("");
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/email-verified` },
      });
      if (otpError) throw otpError;
      setMessage(`We sent a confirmation link to ${address}. Open it to continue.`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "We could not send the confirmation email. Please try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  const verifyEmailUserId = status === "verify-email" ? session?.user.id : undefined;
  const sentVerificationFor = useRef<string | null>(null);
  useEffect(() => {
    if (!verifyEmailUserId) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    if (sentVerificationFor.current !== verifyEmailUserId) {
      sentVerificationFor.current = verifyEmailUserId;
      void sendVerificationEmail();
    }

    // The link opens in another tab; pick up the confirmation here without a manual refresh.
    const timer = window.setInterval(() => {
      void supabase.auth.refreshSession().then(({ data }) => {
        if (data.session?.user.app_metadata.email_link_verified === true) {
          setSession(data.session);
          setStatus(statusForSession(data.session));
          setMessage("");
        }
      });
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyEmailUserId]);

  const contextValue = useMemo<AuthContextValue>(() => ({
    session,
    signOut: async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured yet.");
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setSession(null);
      setStatus(signedOutStatus());
    },
    sendPasswordChangeEmail: async () => {
      const supabase = getSupabaseBrowserClient();
      const address = session?.user.email;
      if (!supabase || !session || !address) throw new Error("Sign in before changing your password.");
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: window.location.origin });
      if (resetError) throw resetError;
      return address;
    },
    updateEmail: async (email: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) throw new Error("Sign in before changing your email.");
      const { error: updateError } = await supabase.auth.updateUser({ email });
      if (updateError) throw updateError;
    },
    updateDisplayName: async (displayName: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) throw new Error("Sign in before changing your name.");
      const { error: updateError } = await supabase.auth.updateUser({
        data: { display_name: displayName },
      });
      if (updateError) throw updateError;
    },
    deleteAccount: async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) throw new Error("Sign in before deleting your account.");

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000"}/api/user/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      let responseBody: { detail?: string } = {};
      try {
        responseBody = await response.json() as { detail?: string };
      } catch {
        if (!response.ok) throw new Error("Unable to delete your account. Please try again.");
      }
      if (!response.ok) throw new Error(responseBody.detail ?? "Unable to delete your account. Please try again.");

      window.localStorage.removeItem(INTRO_COMPLETED_STORAGE_KEY);
      window.dispatchEvent(new Event("zuri-product-intro-change"));
      window.localStorage.removeItem("zuri-journal-entries");
      window.localStorage.removeItem("zuri-watchlist-symbols");
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setSession(null);
      setStatus("intro");
    },
  }), [session]);

  const continueFromIntro = (nextStatus: "welcome" | "sign-in" | "sign-up") => {
    try {
      window.localStorage.setItem(INTRO_COMPLETED_STORAGE_KEY, "true");
      window.dispatchEvent(new Event("zuri-product-intro-change"));
      setError("");
      setMessage("");
      setIntroStep(0);
      setStatus(nextStatus);
    } catch {
      setError("Zuri could not save your onboarding progress. Please enable local storage and try again.");
    }
  };

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
            emailRedirectTo: `${window.location.origin}/email-verified`,
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
      setError(getAuthErrorMessage(authError, status));
    } finally {
      setBusy(false);
    }
  };

  const startSocialSignIn = async (provider: SocialProvider) => {
    setError("");
    setMessage("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Connect Zuri to Supabase first. Add the two Supabase values to frontend/.env.local and backend/.env, then restart the apps.");
      return;
    }

    setBusy(true);
    setActiveProvider(provider);
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (authError) throw authError;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : `Unable to sign in with ${provider}. Please try again.`);
      setBusy(false);
      setActiveProvider(null);
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

  const startOver = async () => {
    setError("");
    setAccountPassword("");
    setConfirmAccountPassword("");
    try {
      await contextValue.signOut();
      setStatus("welcome");
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Unable to sign out. Please try again.");
    }
  };

  const createAccountPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (accountPassword.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (accountPassword !== confirmAccountPassword) {
      setError("The passwords do not match.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setError("Your sign-in session expired. Please sign in with Google again.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000"}/api/user/password`, {
        method: "POST",
        headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ password: accountPassword }),
      });
      if (response.status === 503) {
        // The backend has no admin key configured; a signed-in user can set their own password directly.
        const { error: selfError } = await supabase.auth.updateUser({ password: accountPassword, data: { password_created: true } });
        if (selfError) throw selfError;
        const { data: refreshed } = await supabase.auth.getSession();
        setSession(refreshed.session);
        setStatus(statusForSession(refreshed.session));
        setAccountPassword("");
        setConfirmAccountPassword("");
        return;
      }
      if (response.status === 401) {
        await supabase.auth.signOut({ scope: "local" });
        setSession(null);
        setStatus("sign-in");
        setMessage("Your session expired. If you already created a password, sign in with your email and that password. Otherwise, continue with Google again.");
        return;
      }
      if (!response.ok) {
        let detail = "";
        try {
          detail = ((await response.json()) as { detail?: string }).detail ?? "";
        } catch {}
        throw new Error(detail || "Unable to create your password. Please try again.");
      }
      const email = session.user.email;
      if (!email) throw new Error("Your password was created. Please sign in with your email and new password.");
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password: accountPassword });
      if (signInError) throw new Error("Your password was created. Please sign in with your email and new password.");
      setSession(data.session);
      setStatus(statusForSession(data.session));
      setAccountPassword("");
      setConfirmAccountPassword("");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to create your password. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const finishOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!experience) {
      setError("Choose where you are in your trading journey to continue.");
      return;
    }
    if (markets.length === 0 && !marketsUnsure) {
      setError("Choose at least one market, or select \"I'm not sure yet\".");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setBusy(true);
    try {
      if (!session) throw new Error("Your session expired. Please sign in again.");
      await saveUserProfile({
        id: session.user.id,
        display_name: name.trim() || null,
        trading_experience: experience,
        primary_markets: markets,
      });
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
      {visibleStatus === "workspace" && splashReady ? children : !splashReady || visibleStatus === "loading" ? (
        <main className="auth-loading" aria-label="Loading Zuri">
          <svg className="loading-chart" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <pattern id="loading-chart-grid" width="120" height="90" patternUnits="userSpaceOnUse">
                <path d="M 120 0 H 0 V 90" fill="none" stroke="#bda7df" strokeOpacity=".09" strokeWidth="1" />
              </pattern>
              <linearGradient id="loading-chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#b995ff" stopOpacity=".12" />
                <stop offset="100%" stopColor="#b995ff" stopOpacity="0" />
              </linearGradient>
              <filter id="loading-chart-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="8" />
              </filter>
            </defs>
            <rect className="loading-chart-grid" width="1440" height="900" fill="url(#loading-chart-grid)" />
            <g className="loading-candles" fill="none" strokeWidth="2">
              <path d="M110 470v160m90-175v170m90-180v160m90-170v170m90-180v180m90-185v175m90-180v190m90-195v180m90-185v175m90-180v180m90-190v170m90-180v175m90-185v180m90-185v175m90-180v170" />
            </g>
            <g className="loading-candle-bodies">
              <rect x="100" y="490" width="20" height="60" rx="2" />
              <rect x="190" y="500" width="20" height="70" rx="2" />
              <rect x="280" y="450" width="20" height="90" rx="2" />
              <rect x="370" y="430" width="20" height="65" rx="2" />
              <rect x="460" y="390" width="20" height="100" rx="2" />
              <rect x="550" y="410" width="20" height="75" rx="2" />
              <rect x="640" y="350" width="20" height="90" rx="2" />
              <rect x="730" y="365" width="20" height="85" rx="2" />
              <rect x="820" y="310" width="20" height="110" rx="2" />
              <rect x="910" y="320" width="20" height="80" rx="2" />
              <rect x="1000" y="280" width="20" height="90" rx="2" />
              <rect x="1090" y="290" width="20" height="75" rx="2" />
              <rect x="1180" y="235" width="20" height="95" rx="2" />
              <rect x="1270" y="245" width="20" height="75" rx="2" />
              <rect x="1360" y="210" width="20" height="85" rx="2" />
            </g>
            <path className="loading-chart-area" d="M0 665 L110 610 L200 630 L290 540 L380 565 L470 475 L560 520 L650 430 L740 465 L830 370 L920 405 L1010 325 L1100 355 L1190 270 L1280 300 L1370 220 L1440 245 V900 H0 Z" />
            <path className="loading-chart-glow" d="M0 665 L110 610 L200 630 L290 540 L380 565 L470 475 L560 520 L650 430 L740 465 L830 370 L920 405 L1010 325 L1100 355 L1190 270 L1280 300 L1370 220 L1440 245" />
            <path className="loading-chart-line" pathLength="1" d="M0 665 L110 610 L200 630 L290 540 L380 565 L470 475 L560 520 L650 430 L740 465 L830 370 L920 405 L1010 325 L1100 355 L1190 270 L1280 300 L1370 220 L1440 245" />
          </svg>
          <div className="loading-content" role="status" aria-live="polite">
            <div className="loading-wordmark" aria-label="Zuri">
              <span><i>Z</i><i>U</i></span>
              <span><i>R</i><i>I</i></span>
            </div>
            <span className="loading-kicker">YOUR MARKET, IN FOCUS</span>
          </div>
        </main>
      ) : (
        <main className="auth-shell">
          <header className="auth-topbar">
            <Link className="auth-brand" href="/" aria-label="Zuri home"><Image src="/zuri-logo.jpg" alt="" width={768} height={768} priority /><span>zuri<span className="auth-brand-dot">.</span></span></Link>
            {visibleStatus === "intro" ? (
              <div className="auth-top-actions"><span>Already have an account?</span><button type="button" className="auth-text-button" onClick={() => continueFromIntro("sign-in")}>Sign in</button></div>
            ) : visibleStatus === "welcome" ? (
              <div className="auth-top-actions"><span>Already have an account?</span><button type="button" className="auth-text-button" onClick={() => switchStatus("sign-in")}>Sign in</button></div>
            ) : visibleStatus === "onboarding" ? null : visibleStatus === "set-password" || visibleStatus === "verify-email" ? (
              <button type="button" className="auth-text-button" onClick={() => void startOver()}>Start over</button>
            ) : (
              <button type="button" className="auth-text-button" onClick={() => switchStatus("welcome")}>Back to home</button>
            )}
          </header>

          {visibleStatus === "intro" ? (
            <main className="auth-intro" aria-live="polite">
              <div className="auth-intro-progress" aria-hidden="true"><i style={{ width: `${((introStep + 1) / introSteps.length) * 100}%` }} /></div>
              <div className="auth-intro-stage">
                <div className="auth-intro-copy">
                  <div className="auth-intro-step-copy" key={introStep}>
                    <h1>{introSteps[introStep].title}</h1>
                    <p>{introSteps[introStep].body}</p>
                  </div>
                </div>
                <div className="auth-intro-visual" key={introStep}>
                  <IntroVisual step={introStep} />
                </div>
              </div>
              <div className="auth-intro-footer">
                <div className="auth-intro-dots" aria-label={`Step ${introStep + 1} of ${introSteps.length}`}>
                  {introSteps.map((step, index) => (
                    <button key={step.eyebrow} type="button" aria-label={`Go to introduction step ${index + 1}`} aria-current={index === introStep ? "step" : undefined} onClick={() => setIntroStep(index)} />
                  ))}
                </div>
                <div className="auth-intro-actions">
                  {introStep < introSteps.length - 1 && <button type="button" className="auth-intro-skip" onClick={() => continueFromIntro("sign-up")}>Skip</button>}
                  {introStep > 0 && <button type="button" className="auth-secondary auth-intro-back" onClick={() => setIntroStep((current) => current - 1)}>Back</button>}
                  <button type="button" className="auth-submit auth-intro-next" onClick={() => introStep === introSteps.length - 1 ? continueFromIntro("sign-up") : setIntroStep((current) => current + 1)}>
                    {introStep === introSteps.length - 1 ? "Create my free account" : "Next"} <span>→</span>
                  </button>
                </div>
              </div>
              {introStep === introSteps.length - 1 && <p className="auth-intro-trust">Free to join · No card needed · Practice money only</p>}
              {error && <div className="auth-error" role="alert">{error}</div>}
            </main>
          ) : (
          <div className={`auth-content ${visibleStatus === "welcome" ? "welcome-content" : ""}`}>
            <section className="auth-story">
              <span className="auth-eyebrow auth-market-glow">YOUR MARKET, IN FOCUS</span>
              <h1>{visibleStatus === "welcome" ? <>Trade with a little more <em>clarity.</em></> : visibleStatus === "onboarding" ? <>A desk that starts with <em>you.</em></> : visibleStatus === "set-password" ? <>One more step for your <em>account.</em></> : <>A calmer way to meet the <em>markets.</em></>}</h1>
              <p className="auth-story-copy">A thoughtful trading workspace for charts, plans, and perspective. Build better habits and keep risk in view.</p>
              <div className="auth-promise"><span>✳</span><p><b>Built for better decisions.</b><br />Not louder signals. Not promises. Just a clear place to think.</p></div>
            </section>

            <section className={`auth-card ${visibleStatus === "welcome" ? "auth-welcome-card" : ""}`}>
              {visibleStatus === "welcome" && (
                <>
                  <span className="auth-card-kicker">YOUR TRADING DESK, REIMAGINED</span>
                  <h2>Make room for a better process.</h2>
                  <p>Bring your market watch, trade plans, and AI context into one calmer workspace.</p>
                  <button type="button" className="auth-submit" onClick={() => switchStatus("sign-up")}>Create your account <span>→</span></button>
                  <button type="button" className="auth-secondary" onClick={() => switchStatus("sign-in")}>I already have an account</button>
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <SocialSignInButtons disabled={busy} activeProvider={activeProvider} onProvider={startSocialSignIn} />
                  {!isSupabaseConfigured && <div className="auth-setup-note"><b>One quick setup step remains</b><span>Connect Zuri to Supabase to enable secure accounts. See the setup steps in the frontend README.</span></div>}
                  <div className="auth-fineprint">Zuri is an educational trading workspace and does not provide investment advice. Market quotes come from a public feed and may be delayed.</div>
                </>
              )}

              {visibleStatus === "set-password" && (
                <>
                  <span className="auth-card-kicker">SECURE YOUR ACCOUNT</span>
                  <h2>Create a password</h2>
                  <p>Create a password to continue. You can use it to sign in with your email as well as Google.</p>
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <form className="auth-form" onSubmit={createAccountPassword}>
                    <label>Password<PasswordInput autoComplete="new-password" value={accountPassword} onChange={setAccountPassword} minLength={8} /></label>
                    <label>Confirm password<PasswordInput autoComplete="new-password" value={confirmAccountPassword} onChange={setConfirmAccountPassword} minLength={8} /></label>
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Creating password…" : "Create password"} <span>→</span></button>
                  </form>
                  <div className="auth-switch">Wrong account? <button type="button" onClick={() => void startOver()}>Start over</button></div>
                </>
              )}

              {visibleStatus === "verify-email" && (
                <>
                  <span className="auth-card-kicker">CONFIRM IT&apos;S YOU</span>
                  <h2>Check your email</h2>
                  <p>We sent a confirmation link to <strong>{session?.user.email}</strong>. Open it to verify your email address, then come back to this tab. It will continue on its own.</p>
                  {message && <div className="auth-message" role="status">{message}</div>}
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <button type="button" className="auth-submit" disabled={busy} onClick={() => void sendVerificationEmail()}>{busy ? "Sending…" : "Resend the email"} <span>→</span></button>
                  <div className="auth-switch">Wrong account? <button type="button" onClick={() => void startOver()}>Start over</button></div>
                </>
              )}

              {(visibleStatus === "sign-in" || visibleStatus === "sign-up") && (
                <>
                  <span className="auth-card-kicker">{visibleStatus === "sign-up" ? "A GOOD PLACE TO BEGIN" : "WELCOME BACK"}</span>
                  <h2>{visibleStatus === "sign-up" ? "Create your account" : "Sign in to Zuri"}</h2>
                  <p>{visibleStatus === "sign-up" ? "Your personal trading workspace is a few steps away." : "Pick up where you left off."}</p>
                  {message && <div className="auth-message" role="status">{message}</div>}
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <SocialSignInButtons disabled={busy} activeProvider={activeProvider} onProvider={startSocialSignIn} />
                  <div className="auth-divider"><span>or continue with email</span></div>
                  <form className="auth-form" onSubmit={handleAuth}>
                    <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
                    <label>Password<PasswordInput autoComplete={visibleStatus === "sign-up" ? "new-password" : "current-password"} value={password} onChange={setPassword} placeholder={visibleStatus === "sign-up" ? "At least 8 characters" : "Your password"} minLength={visibleStatus === "sign-up" ? 8 : undefined} /></label>
                    {visibleStatus === "sign-in" && <button type="button" className="auth-forgot" disabled={busy} onClick={() => void sendPasswordReset()}>Forgot password?</button>}
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Please wait…" : visibleStatus === "sign-up" ? "Create account" : "Sign in"} <span>→</span></button>
                  </form>
                  <div className="auth-switch">{visibleStatus === "sign-up" ? "Already have an account?" : "New to Zuri?"} <button type="button" onClick={() => switchStatus(visibleStatus === "sign-up" ? "sign-in" : "sign-up")}>{visibleStatus === "sign-up" ? "Sign in" : "Create an account"}</button></div>
                  <div className="auth-fineprint">Your account is managed securely by Supabase. Zuri never stores your password.</div>
                </>
              )}

              {visibleStatus === "reset-password" && (
                <>
                  <span className="auth-card-kicker">ACCOUNT SECURITY</span>
                  <h2>Choose a new password</h2>
                  <p>Make it at least 8 characters. You can sign in with it next time.</p>
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <form className="auth-form" onSubmit={updatePassword}>
                    <label>New password<PasswordInput autoComplete="new-password" value={password} onChange={setPassword} minLength={8} /></label>
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Updating…" : "Update password"} <span>→</span></button>
                  </form>
                </>
              )}

              {visibleStatus === "onboarding" && (
                <>
                  <h2>Let’s set up your desk.</h2>
                  <p>A couple of quick choices help tailor your starting workspace.</p>
                  {error && <div className="auth-error" role="alert">{error}</div>}
                  <form className="auth-form onboarding-form" onSubmit={finishOnboarding}>
                    <label>What should we call you?<input type="text" autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name (optional)" maxLength={60} /></label>
                    <fieldset><legend>Where are you in your trading journey? <small>Required</small></legend><div className="auth-choice-grid">{(["New to trading", "Learning the basics", "Experienced"] as Experience[]).map((option) => option === "Experienced" ? <button key={option} type="button" disabled aria-disabled="true" className="auth-choice coming-soon" title="Intermediate and expert journeys are coming soon">Experienced<small>Coming soon</small></button> : <button key={option} type="button" aria-pressed={experience === option} className={experience === option ? "auth-choice selected" : "auth-choice"} onClick={() => setExperience(option)}>{option}</button>)}</div><p className="auth-hint">Zuri is built for new traders first. Intermediate and expert journeys are coming soon.</p></fieldset>
                    <fieldset><legend>Which markets interest you? <small>Choose at least one, or tell us you&apos;re not sure</small></legend><div className="auth-choice-grid markets">{(["Stocks", "Crypto", "Forex", "Commodities"] as Market[]).map((market) => <button key={market} type="button" aria-pressed={markets.includes(market)} className={markets.includes(market) ? "auth-choice selected" : "auth-choice"} onClick={() => { setMarketsUnsure(false); setMarkets((current) => current.includes(market) ? current.filter((item) => item !== market) : [...current, market]); }}>{market}</button>)}<button type="button" aria-pressed={marketsUnsure} className={marketsUnsure ? "auth-choice selected" : "auth-choice"} onClick={() => { setMarkets([]); setMarketsUnsure((current) => !current); }}>I&apos;m not sure yet</button></div></fieldset>
                    <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Saving your desk…" : "Open my trading desk"} <span>→</span></button>
                  </form>
                  <div className="auth-fineprint">Your preferences are saved with your account and can be changed later.</div>
                </>
              )}
            </section>
          </div>
          )}
          <footer className="auth-footer"><span>© 2026 Zuri Markets</span><span>Educational workspace · Not financial advice</span><span>Quotes may be delayed</span></footer>
        </main>
      )}
    </AuthContext.Provider>
  );
}

function PasswordInput({ value, onChange, autoComplete, placeholder, minLength }: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="auth-password">
      <input type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} minLength={minLength} required />
      <button type="button" className="auth-password-toggle" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}

function SocialSignInButtons({
  disabled,
  activeProvider,
  onProvider,
}: {
  disabled: boolean;
  activeProvider: SocialProvider | null;
  onProvider: (provider: SocialProvider) => void;
}) {
  return (
    <div className="social-signin-options">
      <button type="button" className="social-signin-button" disabled={disabled} onClick={() => onProvider("google")}>
        <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.9-3.6-11.5-8.5H5.7v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.5 27.6a12 12 0 0 1 0-7.2v-5.2H5.7a20 20 0 0 0 0 17.6l6.8-5.2Z"/><path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8A19.3 19.3 0 0 0 24 4 20 20 0 0 0 5.7 15.2l6.8 5.2c1.6-4.9 6.2-8.5 11.5-8.5Z"/></svg>
        {activeProvider === "google" ? "Connecting to Google…" : "Continue with Google"}
      </button>
    </div>
  );
}

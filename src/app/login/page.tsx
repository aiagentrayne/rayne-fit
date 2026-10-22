"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/client/supabase";
import { Wordmark } from "@/components/Wordmark";

const input = "w-full rounded-xl border border-concrete bg-ink px-4 py-3.5 text-base text-white placeholder:text-concrete";

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supabase = createBrowserSupabase();

  async function run(fn: () => Promise<{ error: { message: string } | null } | void>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r && r.error) setMsg(r.error.message);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function devLogin() {
    await fetch("/api/dev/login", { method: "POST" });
    location.href = "/";
  }

  if (!supabase) {
    return (
      <div className="flex min-h-[80dvh] flex-col items-center justify-center gap-8 text-center">
        <Wordmark size="lg" />
        <p className="text-sm text-muted">Supabase isn&apos;t configured. For local development with DEV_AUTH=1:</p>
        <button onClick={() => void devLogin()} className="w-full rounded-xl bg-lime py-4 text-lg font-black text-ink">Continue as local test user</button>
      </div>
    );
  }

  const signIn = () =>
    run(async () => {
      const r = await supabase.auth.signInWithPassword({ email, password });
      if (!r.error) location.href = "/";
      return r;
    });
  const signUp = () =>
    run(async () => {
      const r = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
      if (!r.error) {
        if (r.data.session) location.href = "/";
        else setMsg("Check your email to confirm your account, then sign in.");
      }
      return r;
    });
  const sendCode = () =>
    run(async () => {
      const r = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (!r.error) setCodeSent(true);
      return r;
    });
  const verifyCode = () =>
    run(async () => {
      const r = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (!r.error) location.href = "/";
      return r;
    });

  return (
    <div className="flex min-h-[85dvh] flex-col justify-center gap-8">
      <div className="text-center">
        <Wordmark size="lg" />
        <p className="mt-6 text-muted">Did you do what you said you would do?</p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (mode === "password" ? signIn() : codeSent ? verifyCode() : sendCode());
        }}
      >
        <label className="sr-only" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode === "password" ? (
          <>
            <label className="sr-only" htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" required minLength={8} className={input} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button disabled={busy} className="w-full rounded-xl bg-lime py-4 text-lg font-black text-ink disabled:opacity-60">Sign in</button>
            <button type="button" disabled={busy} onClick={() => void signUp()} className="w-full rounded-xl border border-lime py-3.5 font-bold text-lime">Create account</button>
          </>
        ) : codeSent ? (
          <>
            <label className="sr-only" htmlFor="code">6-digit code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" required className={`${input} text-center text-2xl tracking-[0.5em]`} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            <button disabled={busy} className="w-full rounded-xl bg-lime py-4 text-lg font-black text-ink">Verify code</button>
          </>
        ) : (
          <button disabled={busy} className="w-full rounded-xl bg-lime py-4 text-lg font-black text-ink">Email me a sign-in code</button>
        )}
        {msg && <p role="alert" className="text-center text-sm text-orange">{msg}</p>}
      </form>
      <button className="text-sm text-muted underline" onClick={() => { setMode(mode === "password" ? "code" : "password"); setCodeSent(false); setMsg(null); }}>
        {mode === "password" ? "Use a one-time email code instead" : "Use a password instead"}
      </button>
      <p className="text-center text-xs text-muted">The code option works best inside the installed iPhone app, since email links open in Safari rather than the app.</p>
    </div>
  );
}

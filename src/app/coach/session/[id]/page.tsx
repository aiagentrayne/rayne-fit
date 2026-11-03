"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/client/api";
import type { SessionView } from "@/client/types";
import { CrisisCard } from "@/components/coach/CrisisCard";
import { ProposalList } from "@/components/coach/Proposals";
import { VoiceButton } from "@/components/coach/VoiceButton";

const TITLE: Record<string, string> = { vision: "Vision interview", weekly: "Weekly interview", monthly: "Monthly interview", quarterly: "Quarterly review", nugget_chat: "Today's nugget" };

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionView | null>(null);
  const [text, setText] = useState("");
  const [viaVoice, setViaVoice] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [speak, setSpeak] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const spoken = useRef<string | null>(null);

  const apply = useCallback((d: SessionView) => {
    setData(d);
    setKeep(new Set(d.commitments.filter((c) => c.status === "proposed").map((c) => c.id)));
  }, []);

  const load = useCallback(async () => {
    try {
      let d = await api<SessionView>(`/api/coach/sessions/${id}`);
      if (d.messages.length === 0 && d.session.status !== "completed" && d.session.status !== "cancelled") {
        setSending(true);
        await api("/api/coach/sessions", { method: "POST", json: { sessionId: id } });
        d = await api<SessionView>(`/api/coach/sessions/${id}`);
      }
      apply(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [id, apply]);

  useEffect(() => {
    void load();
    try {
      setSpeak(localStorage.getItem("ross-speak") === "1");
    } catch {}
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    const last = data?.messages.at(-1);
    if (speak && last?.role === "assistant" && spoken.current !== last.id && "speechSynthesis" in window) {
      spoken.current = last.id;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(last.content));
    }
  }, [data, speak]);

  function toggleSpeak() {
    const next = !speak;
    setSpeak(next);
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (next && data) spoken.current = data.messages.at(-1)?.id ?? null;
    try {
      localStorage.setItem("ross-speak", next ? "1" : "0");
    } catch {}
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    setData((d) => (d ? { ...d, messages: [...d.messages, { id: `tmp-${Date.now()}`, role: "user", content: t, viaVoice, createdAt: new Date().toISOString() }] } : d));
    setText("");
    setViaVoice(false);
    try {
      apply(await api<SessionView>(`/api/coach/sessions/${id}/messages`, { method: "POST", json: { text: t, viaVoice } }));
    } catch (err) {
      setError((err as Error).message);
      // The message was saved even if ROSS couldn't reply; reload to show the real state.
      if (err instanceof ApiError && err.status === 503) {
        try {
          apply(await api<SessionView>(`/api/coach/sessions/${id}`));
        } catch {}
      } else setText(t);
    } finally {
      setSending(false);
    }
  }

  async function retry() {
    setSending(true);
    setError(null);
    try {
      apply(await api<SessionView>(`/api/coach/sessions/${id}/retry`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function finish() {
    setSending(true);
    setError(null);
    try {
      apply(await api<SessionView>(`/api/coach/sessions/${id}/finish`, { method: "POST", json: { keepCommitmentIds: [...keep] } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!data) {
    return (
      <div className="space-y-3 pt-6">
        <Link href="/coach" className="text-sm text-muted underline">‹ Coach</Link>
        <p className="text-muted">{error ?? (sending ? "ROSS is getting ready…" : "Loading…")}</p>
        {error && <button type="button" onClick={() => void load()} className="rounded-xl bg-lime px-4 py-2 font-bold text-ink">Try again</button>}
      </div>
    );
  }

  const s = data.session;
  const closed = s.status === "completed" || s.status === "cancelled";
  const last = data.messages.at(-1);
  const awaitingReply = !closed && last?.role === "user" && !sending;
  const proposed = data.commitments.filter((c) => c.status === "proposed");
  const ready = Boolean(s.summary) && !closed;

  return (
    <div className="flex min-h-[80dvh] flex-col gap-4 pt-2">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/coach" className="text-sm text-muted underline">‹ Coach</Link>
          <h1 className="font-display text-2xl">{TITLE[s.kind]}</h1>
          {s.periodStart && <p className="text-xs text-muted">Covers {s.periodStart} to {s.periodEnd}</p>}
        </div>
        <button type="button" onClick={toggleSpeak} aria-pressed={speak} className={`rounded-full border px-3 py-1 text-xs font-semibold ${speak ? "border-lime text-lime" : "border-concrete text-muted"}`}>
          {speak ? "🔊 Reading aloud" : "🔈 Read aloud"}
        </button>
      </header>

      {data.nugget && <p className="rounded-xl border-l-4 border-lime bg-panel p-3 text-sm">{data.nugget.body}</p>}

      <ol className="flex-1 space-y-3" aria-live="polite">
        {data.messages.map((m) => (
          <li key={m.id} className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 text-[0.95rem] leading-snug ${m.role === "user" ? "ml-auto bg-lime text-ink" : "bg-panel"}`}>
            {m.role === "assistant" && <span className="mb-1 block font-display text-[0.65rem] tracking-widest text-lime">ROSS</span>}
            {m.content}
            {m.viaVoice && <span className="mt-1 block text-[0.65rem] opacity-70">🎙 voice</span>}
          </li>
        ))}
        {sending && <li className="w-24 animate-pulse rounded-2xl bg-panel px-4 py-3 text-sm text-muted">ROSS…</li>}
      </ol>

      {s.safetyPaused && <CrisisCard />}

      {data.proposals.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg">Suggested changes</h2>
          <p className="text-xs text-muted">Nothing changes until you approve it.</p>
          <ProposalList proposals={data.proposals} onDecided={() => void load()} />
        </section>
      )}

      {closed ? (
        <section className="space-y-3 rounded-2xl bg-panel p-4">
          <h2 className="font-display text-lg">Summary</h2>
          <p className="text-sm">{s.summary}</p>
          {data.commitments.filter((c) => c.status !== "dropped").length > 0 && (
            <>
              <h3 className="text-sm font-semibold">Commitments</h3>
              <ul className="list-disc pl-5 text-sm">
                {data.commitments.filter((c) => c.status !== "dropped").map((c) => <li key={c.id}>{c.text}{c.dueDate ? ` (by ${c.dueDate})` : ""}</li>)}
              </ul>
            </>
          )}
          <Link href="/coach" className="inline-block rounded-xl bg-lime px-4 py-2 font-bold text-ink">Back to Coach</Link>
        </section>
      ) : (
        <>
          {(ready || proposed.length > 0) && (
            <section className="space-y-3 rounded-2xl border border-lime/50 p-4">
              <h2 className="font-display text-lg">{ready ? "Wrap up" : "Commitments so far"}</h2>
              {s.summary && <p className="text-sm">{s.summary}</p>}
              {proposed.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Keep these commitments?</legend>
                  {proposed.map((c) => (
                    <label key={c.id} className="flex items-start gap-3 text-sm">
                      <input type="checkbox" className="mt-0.5 h-5 w-5 accent-lime" checked={keep.has(c.id)} onChange={(e) => setKeep((k) => { const n = new Set(k); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                      <span>{c.text}{c.dueDate ? <span className="text-muted"> · by {c.dueDate}</span> : null}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {ready && <button type="button" disabled={sending} onClick={() => void finish()} className="w-full rounded-xl bg-lime py-3 font-black text-ink disabled:opacity-50">Finish interview</button>}
            </section>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-no p-3 text-sm text-no">
              {error}
              {awaitingReply && <button type="button" onClick={() => void retry()} className="ml-2 font-semibold underline">Try again</button>}
            </div>
          )}
          {!error && awaitingReply && (
            <button type="button" onClick={() => void retry()} className="self-start text-sm font-semibold text-lime underline">ROSS hasn&apos;t replied. Ask again</button>
          )}

          <form onSubmit={send} className="sticky bottom-24 space-y-2 rounded-2xl bg-ink/95 py-2">
            <label htmlFor="msg" className="sr-only">Your answer</label>
            <textarea
              id="msg"
              rows={3}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              }}
              placeholder={viaVoice ? "Check the transcript, then send" : "Type your answer…"}
              className="w-full rounded-xl border border-concrete bg-panel px-3 py-3 text-base text-white placeholder:text-concrete"
            />
            <div className="flex gap-2">
              <VoiceButton disabled={sending} onText={(t) => { setText((cur) => (cur ? `${cur} ${t}` : t)); setViaVoice(true); }} onError={setError} />
              <button type="submit" disabled={sending || !text.trim()} className="flex-1 rounded-xl bg-lime py-3 font-black text-ink disabled:opacity-50">Send</button>
              {!ready && (
                <button type="button" disabled={sending} onClick={() => void finish()} className="rounded-xl border border-concrete px-3 text-xs font-semibold disabled:opacity-50" title="End the interview now">
                  End
                </button>
              )}
            </div>
          </form>
        </>
      )}
      <div ref={bottom} />
    </div>
  );
}

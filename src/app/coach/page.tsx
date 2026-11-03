"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";
import { fmtDate } from "@/client/format";
import type { CoachHub, CoachSession, Milestone, Vision } from "@/client/types";
import { NuggetCard } from "@/components/coach/NuggetCard";
import { ProposalList } from "@/components/coach/Proposals";
import { Toggle } from "@/components/ItemForm";

const input = "w-full rounded-xl border border-concrete bg-ink px-3 py-3 text-base text-white placeholder:text-concrete";
const KIND: Record<string, string> = { vision: "Vision interview", weekly: "Weekly interview", monthly: "Monthly interview", quarterly: "Quarterly review", nugget_chat: "Nugget chat" };
const MINUTES: Record<string, string> = { weekly: "5–10 min", monthly: "20–30 min", quarterly: "30–40 min" };

export default function CoachPage() {
  const router = useRouter();
  const [hub, setHub] = useState<CoachHub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setHub(await api<CoachHub>("/api/coach"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function start(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ session: { id: string } }>("/api/coach/sessions", { method: "POST", json: body });
      router.push(`/coach/session/${r.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!hub) return <p className="pt-6 text-muted">{error ?? "Loading…"}</p>;
  if (!hub.ross.enabled) return <Consent hub={hub} onDone={load} />;

  return (
    <div className="space-y-6 pt-2">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Coach</h1>
        <Link href="/settings#ross" className="text-sm font-semibold text-muted underline">ROSS settings</Link>
      </header>
      {!hub.ross.aiConfigured && (
        <p className="rounded-xl border border-hardhat bg-hardhat/10 p-3 text-sm">
          ROSS&apos;s AI isn&apos;t connected yet. Daily nuggets use standard tips for now, and interviews open as soon as it&apos;s connected. Everything else works.
        </p>
      )}
      {error && <p role="alert" className="rounded-xl border border-no p-3 text-sm text-no">{error}</p>}

      <Interviews sessions={hub.scheduled} busy={busy} onStart={(id) => void start({ sessionId: id })} onChanged={load} />

      {hub.nugget && <NuggetCard nugget={hub.nugget} />}

      {hub.proposals.length > 0 && (
        <section id="suggestions" className="space-y-3">
          <h2 className="font-display text-xl">Suggestions from ROSS</h2>
          <p className="text-sm text-muted">Nothing changes until you approve it.</p>
          <ProposalList proposals={hub.proposals} onDecided={load} />
        </section>
      )}

      <VisionSection vision={hub.vision} history={hub.visionHistory} busy={busy} onInterview={() => void start({ kind: "vision" })} onSaved={load} />
      <Milestones milestones={hub.milestones} onChanged={load} />
      <Commitments hub={hub} onChanged={load} />

      <section className="space-y-2">
        <h2 className="font-display text-xl">Interview history</h2>
        <p className="text-sm text-muted">
          Last {hub.participation.days} days: {hub.participation.completed} completed, {hub.participation.missed} missed
          {hub.participation.late ? `, ${hub.participation.late} done late` : ""}{hub.participation.rescheduled ? `, ${hub.participation.rescheduled} rescheduled` : ""}.
        </p>
        {hub.recent.length === 0 ? (
          <p className="text-sm text-muted">No interviews yet.</p>
        ) : (
          <ul className="space-y-2">
            {hub.recent.map((x) => (
              <li key={x.id}>
                <Link href={`/coach/session/${x.id}`} className="block rounded-xl bg-panel p-3">
                  <div className="flex items-center justify-between text-sm">
                    <strong>{KIND[x.kind]}</strong>
                    <span className={x.status === "missed" ? "text-orange" : "text-muted"}>{x.status === "missed" ? "Missed" : x.status === "in_progress" ? "In progress" : fmtDate((x.completedAt ?? x.dueAt ?? "").slice(0, 10), { month: "short", day: "numeric" })}</span>
                  </div>
                  {x.summary && <p className="mt-1 line-clamp-2 text-xs text-muted">{x.summary}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hub.nuggets.length > 0 && (
        <details className="rounded-xl bg-panel p-3">
          <summary className="cursor-pointer text-sm font-semibold">Recent nuggets</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {hub.nuggets.map((n) => (
              <li key={n.id}><span className="text-xs text-muted">{fmtDate(n.date, { month: "short", day: "numeric" })} · </span>{n.body}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/coach/memory" className="rounded-xl border border-concrete px-4 py-2 font-semibold">What ROSS knows ({hub.memoryCount})</Link>
        <Link href="/privacy" className="rounded-xl border border-concrete px-4 py-2 font-semibold">Privacy</Link>
      </div>
      <p className="text-center text-xs text-muted">ROSS is an AI coach, not a therapist or doctor. It can be wrong; you decide what changes.</p>
    </div>
  );
}

function Consent({ hub, onDone }: { hub: CoachHub; onDone: () => void }) {
  const [shareCheckins, setShareCheckins] = useState(true);
  const [shareJournal, setShareJournal] = useState(false);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/coach/enable", { method: "POST", json: { enabled: true, shareCheckins, shareJournal, consent: agree } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 pt-2">
      <h1 className="font-display text-3xl">Meet ROSS</h1>
      <p>ROSS is your AI accountability coach. It helps you set one overarching life vision, then keeps you honest about the actions you choose.</p>
      <ul className="space-y-2 rounded-2xl bg-panel p-4 text-sm">
        <li><strong className="text-lime">Vision interview.</strong> A short conversation about who you want to become, turned into milestones you approve.</li>
        <li><strong className="text-lime">Daily nugget.</strong> One short message each morning: accountability, know-how, or fuel.</li>
        <li><strong className="text-lime">Weekly interview.</strong> 5–10 minutes reviewing what worked, what didn&apos;t, and next week&apos;s commitments. Monthly and quarterly reviews go deeper.</li>
        <li><strong className="text-lime">You stay in charge.</strong> ROSS can suggest changes to your measurables, milestones or vision, but nothing changes until you tap Approve.</li>
      </ul>
      <section className="space-y-3 rounded-2xl border border-concrete p-4 text-sm">
        <h2 className="font-display text-lg">What ROSS shares with OpenAI</h2>
        <p>
          To coach you, Rayne Fit sends OpenAI the relevant parts of your data: your vision, milestones, measurables and their results, interview messages, and coaching memory.
          Rayne Fit asks OpenAI not to store these requests. Voice notes are transcribed; Rayne Fit doesn&apos;t keep the audio.
        </p>
        <Toggle id="share-checkins" checked={shareCheckins} onChange={setShareCheckins} label="Share energy, mood and stress ratings" hint="Helps ROSS spot patterns. You can change this later." />
        <Toggle id="share-journal" checked={shareJournal} onChange={setShareJournal} label="Share journal entries" hint="Off by default. Lets ROSS use what you write." />
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-lime" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I understand ROSS is an AI coach, not medical or mental-health care, and agree to share this data with OpenAI as described in the <Link href="/privacy" className="text-lime underline">privacy notice</Link>. I&apos;m 18 or older.
          </span>
        </label>
      </section>
      {!hub.ross.aiConfigured && <p className="text-xs text-muted">ROSS&apos;s AI connection isn&apos;t set up yet. You can turn ROSS on now; interviews open once it&apos;s connected.</p>}
      {error && <p role="alert" className="text-sm text-no">{error}</p>}
      <button type="button" disabled={!agree || busy} onClick={() => void enable()} className="w-full rounded-xl bg-lime py-4 text-lg font-black text-ink disabled:opacity-50">
        {busy ? "Turning on…" : "Turn on ROSS"}
      </button>
      <p className="text-center text-xs text-muted">You can turn ROSS off or delete everything it knows at any time in Settings.</p>
    </div>
  );
}

function Interviews({ sessions, busy, onStart, onChanged }: { sessions: CoachSession[]; busy: boolean; onStart: (id: string) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  async function reschedule(id: string) {
    setError(null);
    try {
      await api(`/api/coach/sessions/${id}/reschedule`, { method: "POST", json: { dueAt: new Date(when).toISOString() } });
      setEditing(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!sessions.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">Interviews</h2>
      {sessions.map((x) => {
        const due = x.dueAt ? new Date(x.dueAt) : null;
        const overdue = due ? due.getTime() <= now : false;
        return (
          <div key={x.id} className={`rounded-2xl p-4 ${overdue ? "border-2 border-hardhat bg-hardhat/10" : "bg-panel"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{KIND[x.kind]} <span className="text-xs font-normal text-muted">· {MINUTES[x.kind]}</span></p>
                <p className="text-sm text-muted">
                  {due ? `${overdue ? "Due" : "Scheduled"} ${due.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                  {x.status === "in_progress" && " · in progress"}
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => onStart(x.id)} className={`shrink-0 rounded-xl px-4 py-2 font-bold disabled:opacity-50 ${overdue ? "bg-hardhat text-ink" : "border border-lime text-lime"}`}>
                {x.status === "in_progress" ? "Resume" : overdue ? "Start" : "Start early"}
              </button>
            </div>
            {editing === x.id ? (
              <div className="mt-3 flex gap-2">
                <input type="datetime-local" className={input} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="New time" />
                <button type="button" disabled={!when} onClick={() => void reschedule(x.id)} className="rounded-xl bg-lime px-4 font-bold text-ink disabled:opacity-50">Save</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setEditing(x.id); setWhen(""); }} className="mt-2 text-xs font-semibold text-muted underline">Reschedule</button>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="text-sm text-no">{error}</p>}
      <p className="text-xs text-muted">Reminders get firmer if an interview is overdue (at 1, 2 and 3 days), until you do it or reschedule. Snoozing a notification doesn&apos;t count as done.</p>
    </section>
  );
}

function VisionSection({ vision, history, busy, onInterview, onSaved }: { vision: Vision | null; history: Vision[]; busy: boolean; onInterview: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ identity: "", statement: "", oneYear: "", fiveYear: "" });
  const [error, setError] = useState<string | null>(null);

  function edit() {
    setForm({ identity: vision?.identity ?? "", statement: vision?.statement ?? "", oneYear: vision?.oneYear ?? "", fiveYear: vision?.fiveYear ?? "" });
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/coach/vision", { method: "PUT", json: form });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">Vision</h2>
      {editing ? (
        <form onSubmit={save} className="space-y-3 rounded-2xl bg-panel p-4">
          <Field id="identity" label="Who I want to become" value={form.identity} onChange={(v) => setForm({ ...form, identity: v })} rows={2} required />
          <Field id="statement" label="My vision" value={form.statement} onChange={(v) => setForm({ ...form, statement: v })} rows={4} required />
          <Field id="oneyear" label="One year from now" value={form.oneYear} onChange={(v) => setForm({ ...form, oneYear: v })} rows={2} />
          <Field id="fiveyear" label="Five years from now" value={form.fiveYear} onChange={(v) => setForm({ ...form, fiveYear: v })} rows={2} />
          {error && <p role="alert" className="text-sm text-no">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-xl bg-lime py-3 font-bold text-ink">Save vision</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-concrete px-4 font-semibold">Cancel</button>
          </div>
          <p className="text-xs text-muted">Saving keeps your previous version in history.</p>
        </form>
      ) : vision ? (
        <div className="space-y-3 rounded-2xl bg-panel p-4">
          <p className="text-lg font-bold leading-snug">{vision.identity}</p>
          <p className="whitespace-pre-line text-sm">{vision.statement}</p>
          {vision.oneYear && <p className="text-sm"><span className="font-semibold text-lime">1 year: </span>{vision.oneYear}</p>}
          {vision.fiveYear && <p className="text-sm"><span className="font-semibold text-lime">5 years: </span>{vision.fiveYear}</p>}
          <p className="text-xs text-muted">Version {vision.version} · {vision.source === "proposal" ? "approved from ROSS's draft" : "written by you"}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onInterview} className="flex-1 rounded-xl border border-lime py-2.5 text-sm font-bold text-lime disabled:opacity-50">Revise with ROSS</button>
            <button type="button" onClick={edit} className="flex-1 rounded-xl border border-concrete py-2.5 text-sm font-semibold">Edit myself</button>
          </div>
          {history.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Earlier versions</summary>
              <ul className="mt-2 space-y-2">{history.map((h) => <li key={h.id}><strong>v{h.version}</strong> · {h.identity}</li>)}</ul>
            </details>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-dashed border-lime/60 p-4">
          <p className="text-sm">You haven&apos;t set a vision yet. ROSS can interview you (about 10 minutes, one question at a time, pause any time), or you can write it yourself.</p>
          <button type="button" disabled={busy} onClick={onInterview} className="w-full rounded-xl bg-lime py-3 font-black text-ink disabled:opacity-50">{busy ? "Starting…" : "Start vision interview"}</button>
          <button type="button" onClick={edit} className="w-full rounded-xl border border-concrete py-2.5 text-sm font-semibold">Write it myself</button>
        </div>
      )}
    </section>
  );
}

function Field({ id, label, value, onChange, rows, required }: { id: string; label: string; value: string; onChange: (v: string) => void; rows: number; required?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">{label}</label>
      <textarea id={id} rows={rows} className={input} value={value} required={required} maxLength={4000} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Milestones({ milestones, onChanged }: { milestones: Milestone[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [horizon, setHorizon] = useState<"1y" | "5y" | "other">("1y");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/coach/milestones", { method: "POST", json: { title, horizon, targetDate: targetDate || null } });
      setTitle("");
      setTargetDate("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setStatus(m: Milestone, status: Milestone["status"]) {
    await api(`/api/coach/milestones/${m.id}`, { method: "PATCH", json: { status } }).catch((e) => setError(e.message));
    onChanged();
  }

  const active = milestones.filter((m) => m.status === "active");
  const closed = milestones.filter((m) => m.status !== "active");
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Milestones</h2>
        <button type="button" onClick={() => setAdding((a) => !a)} className="text-sm font-semibold text-lime">{adding ? "Cancel" : "+ Add"}</button>
      </div>
      {adding && (
        <form onSubmit={add} className="space-y-3 rounded-2xl bg-panel p-4">
          <input className={input} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Run a half marathon" aria-label="Milestone" />
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={horizon} onChange={(e) => setHorizon(e.target.value as typeof horizon)} aria-label="Horizon">
              <option value="1y">1-year</option>
              <option value="5y">5-year</option>
              <option value="other">Other</option>
            </select>
            <input type="date" className={input} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} aria-label="Target date" />
          </div>
          <button type="submit" className="w-full rounded-xl bg-lime py-3 font-bold text-ink">Add milestone</button>
        </form>
      )}
      {active.length === 0 && !adding && <p className="text-sm text-muted">No milestones yet. Add your own, or get suggestions in the vision interview.</p>}
      <ul className="space-y-2">
        {active.map((m) => (
          <li key={m.id} className="rounded-xl bg-panel p-3">
            <p className="font-semibold">{m.title}</p>
            <p className="text-xs text-muted">{m.horizon === "1y" ? "1-year" : m.horizon === "5y" ? "5-year" : "Milestone"}{m.targetDate ? ` · target ${fmtDate(m.targetDate, { month: "short", day: "numeric", year: "numeric" })}` : ""}</p>
            <div className="mt-2 flex gap-2 text-xs font-semibold">
              <button type="button" onClick={() => void setStatus(m, "achieved")} className="rounded-lg border border-lime px-3 py-1.5 text-lime">Achieved</button>
              <button type="button" onClick={() => void setStatus(m, "dropped")} className="rounded-lg border border-concrete px-3 py-1.5">Drop</button>
            </div>
          </li>
        ))}
      </ul>
      {closed.length > 0 && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">Achieved and dropped ({closed.length})</summary>
          <ul className="mt-2 space-y-1">
            {closed.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span>{m.status === "achieved" ? "✓ " : "– "}{m.title}</span>
                <button type="button" onClick={() => void setStatus(m, "active")} className="text-xs underline">Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p role="alert" className="text-sm text-no">{error}</p>}
    </section>
  );
}

function Commitments({ hub, onChanged }: { hub: CoachHub; onChanged: () => void }) {
  const open = hub.commitments.filter((c) => c.status === "open");
  const done = hub.commitments.filter((c) => c.status !== "open");
  if (!hub.commitments.length) return null;
  async function set(id: string, status: string) {
    await api(`/api/coach/commitments/${id}`, { method: "PATCH", json: { status } }).catch(() => {});
    onChanged();
  }
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">Commitments</h2>
      <ul className="space-y-2">
        {open.map((c) => (
          <li key={c.id} className="rounded-xl bg-panel p-3">
            <p>{c.text}</p>
            {c.dueDate && <p className="text-xs text-muted">By {fmtDate(c.dueDate, { weekday: "short", month: "short", day: "numeric" })}</p>}
            <div className="mt-2 flex gap-2 text-xs font-semibold">
              <button type="button" onClick={() => void set(c.id, "kept")} className="rounded-lg border border-yes px-3 py-1.5 text-yes">Kept</button>
              <button type="button" onClick={() => void set(c.id, "missed")} className="rounded-lg border border-no px-3 py-1.5 text-no">Missed</button>
              <button type="button" onClick={() => void set(c.id, "dropped")} className="rounded-lg border border-concrete px-3 py-1.5">Drop</button>
            </div>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <p className="text-xs text-muted">Recent: {done.filter((c) => c.status === "kept").length} kept, {done.filter((c) => c.status === "missed").length} missed.</p>
      )}
    </section>
  );
}

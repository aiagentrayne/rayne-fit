"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";
import { fmtDate } from "@/client/format";
import type { ReviewStatus } from "@/client/types";
import { CheckinScale } from "@/components/coach/CheckinScale";
import { CrisisCard } from "@/components/coach/CrisisCard";
import { METRIC_INFO, type Metric } from "@/lib/core/coach";
import { addDays } from "@/lib/core/time";

interface CheckinDay {
  date: string;
  today: string;
  earliest: string;
  checkins: { metric: Metric; rating: number; note: string | null; recordedAt: string; late: boolean }[];
  review: ReviewStatus;
  journal: string;
  crisis?: boolean;
}

const input = "w-full rounded-xl border border-concrete bg-ink px-3 py-3 text-base text-white placeholder:text-concrete";

export default function CheckinPage() {
  const [day, setDay] = useState<CheckinDay | null>(null);
  const [notes, setNotes] = useState<Partial<Record<Metric, string>>>({});
  const [journal, setJournal] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);

  const load = useCallback(async (d: string | null) => {
    try {
      const r = await api<CheckinDay>(`/api/checkins${d ? `?date=${d}` : ""}`);
      setDay(r);
      setJournal(r.journal);
      setNotes(Object.fromEntries(r.checkins.map((c) => [c.metric, c.note ?? ""])));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const d = new URLSearchParams(location.search).get("date");
    void load(d);
  }, [load]);

  function flash(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(null), 1500);
  }

  async function rate(metric: Metric, rating: number) {
    if (!day) return;
    try {
      const r = await api<CheckinDay>("/api/checkins", { method: "POST", json: { date: day.date, metric, rating, note: notes[metric] || null } });
      setDay(r);
      if (r.crisis) setCrisis(true);
      flash("Saved");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveNote(metric: Metric) {
    const c = day?.checkins.find((x) => x.metric === metric);
    if (!day || !c || (c.note ?? "") === (notes[metric] ?? "")) return;
    await rate(metric, c.rating);
  }

  async function clear(metric: Metric) {
    if (!day) return;
    try {
      setDay(await api<CheckinDay>(`/api/checkins?date=${day.date}&metric=${metric}`, { method: "DELETE" }));
      setNotes((n) => ({ ...n, [metric]: "" }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveJournal() {
    if (!day || journal === day.journal) return;
    try {
      const r = await api<{ crisis: boolean }>("/api/journal", { method: "PUT", json: { date: day.date, body: journal } });
      setDay({ ...day, journal });
      if (r.crisis) setCrisis(true);
      flash("Journal saved");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function go(delta: number) {
    if (!day) return;
    const next = addDays(day.date, delta);
    if (next > day.today || next < day.earliest) return;
    history.replaceState(null, "", `/checkin?date=${next}`);
    void load(next);
  }

  if (!day) return <p className="pt-6 text-muted">{error ?? "Loading…"}</p>;
  const isToday = day.date === day.today;
  const late = (m: Metric) => day.checkins.find((c) => c.metric === m)?.late;

  return (
    <div className="space-y-5 pt-2">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Check-in</h1>
        <span aria-live="polite" className="text-sm text-lime">{saved}</span>
      </header>

      <div className="flex items-center justify-between rounded-xl bg-panel px-2 py-2">
        <button type="button" onClick={() => go(-1)} disabled={day.date <= day.earliest} className="h-10 w-10 rounded-lg border border-concrete disabled:opacity-30" aria-label="Previous day">‹</button>
        <div className="text-center">
          <p className="font-semibold">{isToday ? "Today" : fmtDate(day.date)}</p>
          <p className={`text-xs ${day.review.complete ? "text-lime" : "text-hardhat"}`}>
            Daily review {day.review.complete ? "complete" : `incomplete (${3 - day.review.missing.length} of 3)`}
          </p>
        </div>
        <button type="button" onClick={() => go(1)} disabled={isToday} className="h-10 w-10 rounded-lg border border-concrete disabled:opacity-30" aria-label="Next day">›</button>
      </div>
      {!isToday && <p className="text-xs text-muted">Late entries are saved with the time you enter them.</p>}

      {crisis && <CrisisCard />}

      {(["energy", "mood", "stress"] as Metric[]).map((m) => {
        const has = day.review[m] !== null;
        return (
          <section key={m} className="space-y-3 rounded-2xl bg-panel p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">{METRIC_INFO[m].when === "morning" ? "After waking" : "Evening recap"}</p>
            <CheckinScale metric={m} value={day.review[m]} onPick={(r) => void rate(m, r)} />
            {has && (
              <div className="space-y-2">
                <label className="sr-only" htmlFor={`note-${m}`}>{METRIC_INFO[m].title} note</label>
                <input id={`note-${m}`} className={input} maxLength={500} placeholder="Optional note" value={notes[m] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [m]: e.target.value }))} onBlur={() => void saveNote(m)} />
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{late(m) ? "Entered late" : ""}</span>
                  <button type="button" className="underline" onClick={() => void clear(m)}>Clear rating</button>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <section className="space-y-2 rounded-2xl bg-panel p-4">
        <label htmlFor="journal" className="font-display text-lg">Journal</label>
        <p className="text-xs text-muted">Optional. What happened today, what got in the way, what worked. Shared with ROSS only if you turn that on in <Link href="/settings#ross" className="underline">Settings</Link>.
        </p>
        <textarea id="journal" rows={5} maxLength={4000} className={input} value={journal} onChange={(e) => setJournal(e.target.value)} onBlur={() => void saveJournal()} placeholder="A few lines is plenty." />
        <button type="button" onClick={() => void saveJournal()} disabled={journal === day.journal} className="rounded-xl border border-concrete px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Save journal
        </button>
      </section>

      {error && <p role="alert" className="rounded-xl border border-no p-3 text-sm text-no">{error}</p>}
      <p className="text-center text-xs text-muted">Ratings are for your own awareness and coaching context. They never change your scores and aren&apos;t a medical assessment.</p>
    </div>
  );
}

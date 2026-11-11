"use client";

import Link from "next/link";
import { useState } from "react";
import { api, newMutationId } from "@/client/api";
import { fmtInstant } from "@/client/format";
import type { DashboardCoach, PeriodMeasurable, ReviewStatus } from "@/client/types";
import { CheckinScale } from "./CheckinScale";
import { CrisisCard } from "./CrisisCard";
import type { Metric } from "@/lib/core/coach";
import { addDays } from "@/lib/core/time";

const INTERVIEW_NAME: Record<string, string> = { weekly: "Weekly interview", monthly: "Monthly interview", quarterly: "Quarterly review" };

/** Three required ratings: energy after waking, mood and stress in the evening recap. */
export function DailyReviewCard({ date, review, open, onChange }: { date: string; review: ReviewStatus; open: boolean; onChange: () => void }) {
  const [local, setLocal] = useState<Partial<Record<Metric, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const value = (m: Metric) => local[m] ?? review[m];
  const done = (["energy", "mood", "stress"] as Metric[]).filter((m) => value(m) !== null).length;
  const hour = new Date().getHours();
  const evening = hour >= 16;

  async function pick(metric: Metric, rating: number) {
    setLocal((l) => ({ ...l, [metric]: rating }));
    setError(null);
    try {
      const r = await api<{ crisis?: boolean }>("/api/checkins", { method: "POST", json: { date, metric, rating } });
      if (r.crisis) setCrisis(true);
      onChange();
    } catch (e) {
      setLocal((l) => ({ ...l, [metric]: undefined }));
      setError((e as Error).message);
    }
  }

  const order: Metric[] = evening ? ["mood", "stress", "energy"] : ["energy", "mood", "stress"];
  return (
    <section aria-label="Daily review" className="rounded-2xl bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">Daily review</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${done === 3 ? "bg-lime text-ink" : "border border-hardhat text-hardhat"}`}>
          {done === 3 ? "Complete" : `${done} of 3 · incomplete`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">Energy after waking; mood and stress in your evening recap. Missing ratings never count as low.</p>
      <div className="mt-3 space-y-4">
        {order.map((m) => (
          <CheckinScale key={m} metric={m} value={value(m)} onPick={(r) => void pick(m, r)} disabled={!open} compact />
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-no">{error}</p>}
      {crisis && <div className="mt-3"><CrisisCard /></div>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
        <Link href={`/checkin?date=${date}`} className="text-lime underline">Add notes or a journal entry</Link>
        <Link href={`/checkin?date=${addDays(date, -1)}`} className="text-muted underline">Edit yesterday&apos;s ratings</Link>
      </div>
    </section>
  );
}

export function CoachPrompts({ coach, tz }: { coach: DashboardCoach; tz: string }) {
  if (!coach.rossEnabled) {
    return (
      <Link href="/coach" className="block rounded-2xl border border-dashed border-lime/60 p-4">
        <p className="font-display text-sm tracking-widest text-lime">MEET ROSS</p>
        <p className="mt-1 text-sm">Your AI accountability coach: a life vision, a daily nugget, and weekly interviews that keep you honest. Off until you turn it on.</p>
      </Link>
    );
  }
  const due = coach.dueInterview;
  return (
    <div className="space-y-2">
      {due && (
        <Link href={`/coach/session/${due.id}`} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-hardhat bg-hardhat/10 p-3">
          <span>
            <strong>{INTERVIEW_NAME[due.kind] ?? "Interview"} is due</strong>
            <span className="block text-xs text-muted">Due {fmtInstant(due.dueAt!, tz)} {new Date(due.dueAt!).toDateString() !== new Date().toDateString() ? `on ${new Date(due.dueAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "today"}</span>
          </span>
          <span className="shrink-0 rounded-xl bg-hardhat px-3 py-2 text-sm font-bold text-ink">{due.status === "in_progress" ? "Resume" : "Start"}</span>
        </Link>
      )}
      {!coach.hasVision && (
        <Link href="/coach" className="block rounded-2xl border border-lime/60 p-3 text-sm">
          <strong className="text-lime">Set your vision with ROSS.</strong> A short interview about who you want to become.
        </Link>
      )}
      {coach.pendingProposals > 0 && (
        <Link href="/coach#suggestions" className="block rounded-2xl border border-concrete p-3 text-sm">
          ROSS has <strong>{coach.pendingProposals}</strong> suggestion{coach.pendingProposals === 1 ? "" : "s"} waiting for your approval.
        </Link>
      )}
    </div>
  );
}

/** Weekly and monthly targets: logged any day, graded per period, never part of the day score. */
export function PeriodMeasurables({ date, items, open, onChange }: { date: string; items: PeriodMeasurable[]; open: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;

  async function log(item: PeriodMeasurable, undo: boolean) {
    setBusy(item.itemId);
    setError(null);
    try {
      if (undo) await api(`/api/measurables/log?itemId=${item.itemId}&date=${date}`, { method: "DELETE" });
      else await api("/api/measurables/log", { method: "POST", json: { itemId: item.itemId, date, mutationId: newMutationId() } });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Weekly and monthly targets">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Weekly &amp; monthly targets</h2>
      <ul className="space-y-3">
        {items.map((i) => {
          const pct = Math.min(100, (i.count / i.target) * 100);
          return (
            <li key={i.itemId} className={`rounded-2xl border-2 bg-panel p-3 ${i.met ? "border-yes" : "border-panel-2"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{i.name}</p>
                  <p className="text-xs text-muted">
                    {i.count} of {i.target} this {i.cadence === "weekly" ? "week" : "month"}
                    {i.countToday > 0 && ` · ${i.countToday} today`}
                    {i.previous && ` · last ${i.cadence === "weekly" ? "week" : "month"} ${i.previous.count}/${i.previous.target}`}
                  </p>
                </div>
                {i.met && <span className="shrink-0 rounded-full bg-yes px-2 py-0.5 text-xs font-bold text-ink">Target met</span>}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink" role="progressbar" aria-valuemin={0} aria-valuemax={i.target} aria-valuenow={i.count} aria-label={`${i.name} progress`}>
                <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={!open || busy === i.itemId} onClick={() => void log(i, false)} className="min-h-12 flex-1 rounded-xl bg-lime font-black text-ink disabled:opacity-50">
                  + Did it today
                </button>
                {i.countToday > 0 && (
                  <button type="button" disabled={busy === i.itemId} onClick={() => void log(i, true)} className="rounded-xl border border-concrete px-4 text-sm font-semibold disabled:opacity-50">
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-no">{error}</p>}
    </section>
  );
}

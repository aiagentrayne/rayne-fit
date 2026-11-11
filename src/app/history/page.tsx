"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, newMutationId } from "@/client/api";
import { cacheGet, cacheSet } from "@/client/offline";
import { fmtDate } from "@/client/format";
import type { DayItem, Settings } from "@/client/types";
import type { Period } from "@/components/PeriodCard";
import { scoreColor } from "@/components/ScoreRing";
import { useShell } from "@/components/AppShell";
import { formatPct, gradeFor } from "@/lib/core/grading";
import { addDays, isoWeekday, monthRange } from "@/lib/core/time";
import Link from "next/link";
import { CheckinScale } from "@/components/coach/CheckinScale";
import type { ReviewStatus } from "@/client/types";
import type { Metric } from "@/lib/core/coach";

interface History {
  today: string;
  settings: Settings;
  days: { date: string; status: "open" | "final"; applicable: number; yes: number }[];
  streaks: { current: number; longest: number; perfectDays: number };
  overallAverage: number | null;
  itemRates: { itemId: string; name: string; rates: Record<string, { pct: number | null; days: number }>; missesLast30: number }[];
  frequentlyMissed: { itemId: string; name: string; missesLast30: number }[];
  weekly: Period[];
  monthly: Period[];
}

interface DayDetail {
  day: { date: string; status: "open" | "final"; applicable: number; yes: number; scorePct: number | null; grade: string | null } | null;
  items: DayItem[];
  corrections: { id: number; itemName: string; oldValue: string | null; newValue: string | null; kind: string; reason: string | null; createdAt: string }[];
}

export default function HistoryPage() {
  const { version } = useShell();
  const [h, setH] = useState<History | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<History>("/api/history");
      setH(data);
      await cacheSet("history", data);
    } catch {
      const c = await cacheGet<History>("history");
      if (c) setH(c);
    }
  }, []);
  useEffect(() => void load(), [load, version]);

  if (!h) return <p className="pt-6 text-muted">Loading history…</p>;
  const thresholds = h.settings.gradeThresholds;
  const m = month ?? h.today.slice(0, 7) + "-01";

  return (
    <div className="space-y-6 pt-2">
      <h1 className="font-display text-3xl">History</h1>

      <section className="grid grid-cols-2 gap-3" aria-label="Streaks and totals">
        <Stat label="Current perfect streak" value={`${h.streaks.current}`} unit={h.streaks.current === 1 ? "day" : "days"} />
        <Stat label="Longest perfect streak" value={`${h.streaks.longest}`} unit={h.streaks.longest === 1 ? "day" : "days"} />
        <Stat label="Perfect days" value={`${h.streaks.perfectDays}`} />
        <Stat label="Overall average" value={h.overallAverage === null ? "N/A" : formatPct(h.overallAverage)} unit={h.overallAverage === null ? "" : gradeFor(h.overallAverage, thresholds)} />
      </section>
      <p className="-mt-3 text-xs text-muted">Days with nothing scheduled (N/A) don&apos;t break or extend streaks.</p>

      <Calendar history={h} month={m} onMonth={setMonth} onSelect={setSelected} />
      {selected && <DayPanel date={selected} onClose={() => setSelected(null)} onChanged={load} />}

      <Trend title="Weekly grades (last 12 weeks)" periods={h.weekly} label={(p) => fmtDate(p.start, { month: "numeric", day: "numeric" })} />
      <Trend title="Monthly grades (last 12 months)" periods={h.monthly} label={(p) => fmtDate(p.start, { month: "short" })} />

      <section aria-labelledby="rates-h">
        <h2 id="rates-h" className="font-display mb-2 text-xl">Item completion</h2>
        <p className="mb-2 text-xs text-muted">Share of YES over each item&apos;s last 7, 30, 90 and 365 scheduled days.</p>
        <div className="overflow-x-auto rounded-2xl bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="p-3 font-semibold">Item</th>
                {[7, 30, 90, 365].map((w) => (
                  <th key={w} className="p-3 text-right font-semibold">{w}d</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.itemRates.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-muted">No finalized days yet.</td>
                </tr>
              )}
              {h.itemRates.map((r) => (
                <tr key={r.itemId} className="border-t border-panel-2">
                  <td className="p-3 font-semibold">{r.name}</td>
                  {[7, 30, 90, 365].map((w) => (
                    <td key={w} className="p-3 text-right tabular-nums" style={{ color: scoreColor(r.rates[w].pct) }}>
                      {r.rates[w].pct === null ? "—" : formatPct(r.rates[w].pct)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {h.frequentlyMissed.length > 0 && (
        <section aria-labelledby="missed-h">
          <h2 id="missed-h" className="font-display mb-2 text-xl">Most missed (last 30 scheduled days)</h2>
          <ul className="space-y-2">
            {h.frequentlyMissed.map((r) => (
              <li key={r.itemId} className="flex justify-between rounded-xl bg-panel px-3 py-2 text-sm">
                <span>{r.name}</span>
                <span className="font-bold text-no">{r.missesLast30} NO</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl bg-panel p-4">
      <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1">
        <span className="font-display text-3xl">{value}</span> {unit && <span className="text-sm text-muted">{unit}</span>}
      </p>
    </div>
  );
}

function Calendar({ history, month, onMonth, onSelect }: { history: History; month: string; onMonth: (m: string) => void; onSelect: (d: string) => void }) {
  const byDate = useMemo(() => new Map(history.days.map((d) => [d.date, d])), [history.days]);
  const { start, end } = monthRange(month);
  const weekStart = history.settings.weekStart;
  const lead = (isoWeekday(start) - weekStart + 7) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push(d);
  const dayNames = Array.from({ length: 7 }, (_, i) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(weekStart - 1 + i) % 7]);
  const thresholds = history.settings.gradeThresholds;
  const prev = addDays(start, -1).slice(0, 8) + "01";
  const next = addDays(end, 1);

  return (
    <section aria-labelledby="cal-h" className="rounded-2xl bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <button className="h-10 w-10 rounded-lg border border-concrete" onClick={() => onMonth(prev)} aria-label="Previous month">‹</button>
        <h2 id="cal-h" className="font-display text-lg">{fmtDate(start, { month: "long", year: "numeric" })}</h2>
        <button className="h-10 w-10 rounded-lg border border-concrete disabled:opacity-30" disabled={next > history.today} onClick={() => onMonth(next)} aria-label="Next month">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] text-muted" aria-hidden="true">
        {dayNames.map((n) => <span key={n}>{n}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const rec = byDate.get(d);
          const future = d > history.today;
          const na = rec && rec.applicable === 0;
          const pct = rec && rec.applicable > 0 ? (rec.yes / rec.applicable) * 100 : null;
          const grade = pct === null ? null : gradeFor(pct, thresholds);
          const desc = future ? "upcoming" : !rec ? "not scored" : na ? "N/A, nothing scheduled" : `${formatPct(pct)} ${grade}${rec.status === "open" ? ", in progress" : ""}`;
          return (
            <button
              key={d}
              disabled={future || !rec}
              onClick={() => onSelect(d)}
              aria-label={`${fmtDate(d)}: ${desc}`}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${na ? "hazard bg-panel-2 text-muted" : ""} ${!rec || future ? "text-concrete" : ""} ${rec?.status === "open" ? "ring-2 ring-white/60" : ""}`}
              style={pct !== null ? { background: scoreColor(pct), color: "#121212" } : undefined}
            >
              <span className="font-semibold">{Number(d.slice(8))}</span>
              <span className="font-display text-[0.7rem] leading-none">{na ? "N/A" : grade ?? ""}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[0.7rem] text-muted">Tap a day to see its answers. Striped = N/A (nothing scheduled). Outlined = today, still open.</p>
    </section>
  );
}

function DayPanel({ date, onClose, onChanged }: { date: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<DayDetail | null>(null);
  const [editing, setEditing] = useState<DayItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = useRef<HTMLElement>(null);
  const load = useCallback(() => api<DayDetail>(`/api/days/${date}`).then(setD, (e) => setError(e.message)), [date]);
  useEffect(() => void load(), [load]);
  useEffect(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), [date]);

  async function correct(value: "yes" | "no") {
    if (!editing) return;
    setBusy(true);
    try {
      const { result } = await api<{ result: { outcome: string } }>("/api/corrections", { method: "POST", json: { mutationId: newMutationId(), date, itemId: editing.itemId, value, reason: reason || null } });
      if (result.outcome !== "apply" && result.outcome !== "noop") setError(`Correction not applied (${result.outcome}).`);
      setEditing(null);
      setReason("");
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section ref={ref} className="scroll-mt-4 rounded-2xl border border-concrete bg-ink p-4" aria-label={`Details for ${fmtDate(date)}`}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl">{fmtDate(date)}</h2>
          {d?.day && (
            <p className="text-sm">
              {d.day.applicable === 0 ? "N/A — nothing scheduled" : `${d.day.yes}/${d.day.applicable} YES · ${formatPct(d.day.scorePct)} ${d.day.grade}`}
              <span className="ml-2 text-xs text-muted">{d.day.status === "final" ? "Final" : "Open"}</span>
            </p>
          )}
        </div>
        <button onClick={onClose} className="h-9 w-9 rounded-lg border border-concrete" aria-label="Close day details">✕</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-no">{error}</p>}
      <ul className="mt-3 space-y-2">
        {!d && !error && <li className="text-sm text-muted">Loading…</li>}
        {d?.items.map((i) => (
          <li key={i.itemId} className="flex items-center justify-between gap-2 rounded-xl bg-panel px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{i.name}</span>
              {i.autoFinalized && <span className="text-xs text-muted">Unanswered at cutoff</span>}
              {i.source === "correction" && <span className="text-xs text-hardhat">Corrected</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-ink ${i.response === "yes" ? "bg-yes" : i.response === "no" ? "bg-no" : "bg-concrete"}`}>
                {i.response === "yes" ? "✓ YES" : i.response === "no" ? "✕ NO" : "Pending"}
              </span>
              {d.day?.status === "final" && (
                <button className="text-xs font-semibold text-hardhat underline" onClick={() => setEditing(i)}>Correct</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {d?.day?.status === "open" && <p className="mt-2 text-xs text-muted">This day is still open. Change answers on the Today screen.</p>}

      <DayCheckins date={date} />

      {editing && (
        <div className="mt-4 space-y-3 rounded-xl border border-hardhat p-3">
          <p className="text-sm font-semibold">Correct &ldquo;{editing.name}&rdquo; (currently {editing.response?.toUpperCase()})</p>
          <label className="block text-xs text-muted" htmlFor="reason">Reason (optional, kept in the audit trail)</label>
          <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="w-full rounded-lg border border-concrete bg-ink px-3 py-2" />
          <div className="grid grid-cols-3 gap-2">
            <button disabled={busy} onClick={() => void correct("yes")} className="rounded-lg bg-yes py-2 font-bold text-ink">✓ YES</button>
            <button disabled={busy} onClick={() => void correct("no")} className="rounded-lg bg-no py-2 font-bold text-ink">✕ NO</button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-concrete py-2">Cancel</button>
          </div>
        </div>
      )}

      {d && d.corrections.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">Audit trail ({d.corrections.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {d.corrections.map((c) => (
              <li key={c.id}>
                {new Date(c.createdAt).toLocaleString()}: {c.itemName} {c.oldValue?.toUpperCase() ?? "—"} → {c.newValue?.toUpperCase()}
                {c.kind === "late_offline_sync" ? " (offline answer synced late)" : ""}
                {c.reason ? ` · "${c.reason}"` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Trend({ title, periods, label }: { title: string; periods: Period[]; label: (p: Period) => string }) {
  const id = title.replace(/\W+/g, "-").toLowerCase();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-display mb-2 text-xl">{title}</h2>
      <div className="rounded-2xl bg-panel p-3">
        <div className="flex h-40 items-end gap-1" role="img" aria-label={`${title} bar chart. A table with the same data follows.`}>
          {periods.map((p) => (
            <div key={p.start} className="flex h-full flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[0.6rem] font-display" style={{ color: scoreColor(p.pct) }}>{p.grade ?? ""}</span>
              <div
                className={`w-full rounded-t ${p.pct === null ? "hazard opacity-30" : ""}`}
                style={{ height: p.pct === null ? "4px" : `${Math.max(3, p.pct)}%`, background: p.pct === null ? undefined : scoreColor(p.pct), opacity: p.provisional ? 0.65 : 1 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1 text-[0.55rem] text-muted" aria-hidden="true">
          {periods.map((p, i) => (
            <span key={p.start} className="flex-1 truncate text-center">{i % 2 === periods.length % 2 ? label(p) : ""}</span>
          ))}
        </div>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-muted">View as table</summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1">Period</th>
                <th className="py-1 text-right">Score</th>
                <th className="py-1 text-right">Grade</th>
                <th className="py-1 text-right">Days</th>
              </tr>
            </thead>
            <tbody>
              {[...periods].reverse().map((p) => (
                <tr key={p.start} className="border-t border-panel-2">
                  <td className="py-1">{label(p)}{p.provisional ? " (provisional)" : ""}</td>
                  <td className="py-1 text-right tabular-nums">{formatPct(p.pct)}</td>
                  <td className="py-1 text-right">{p.grade ?? "—"}</td>
                  <td className="py-1 text-right">{p.countedDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

interface CheckinDayView {
  date: string;
  today: string;
  earliest: string;
  review: ReviewStatus;
  journal: string;
}

/** Energy, mood and stress for a past day, editable for the last 30 days. */
function DayCheckins({ date }: { date: string }) {
  const [c, setC] = useState<CheckinDayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setC(null);
    api<CheckinDayView>(`/api/checkins?date=${date}`).then(setC, (e) => setError(e.message));
  }, [date]);

  async function pick(metric: Metric, rating: number) {
    setError(null);
    try {
      setC(await api<CheckinDayView>("/api/checkins", { method: "POST", json: { date, metric, rating } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!c) return error ? <p className="mt-3 text-xs text-muted">{error}</p> : null;
  const editable = date >= c.earliest && date <= c.today;
  return (
    <div className="mt-4 space-y-3 border-t border-panel-2 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Check-in</h3>
        <span className="text-xs" aria-live="polite">
          {saved ? <span className="text-lime">Saved</span> : <span className={c.review.complete ? "text-lime" : "text-muted"}>{c.review.complete ? "Review complete" : `${3 - c.review.missing.length} of 3 recorded`}</span>}
        </span>
      </div>
      {(["energy", "mood", "stress"] as Metric[]).map((m) => (
        <CheckinScale key={m} metric={m} value={c.review[m]} onPick={(r) => void pick(m, r)} disabled={!editable} compact />
      ))}
      {!editable && <p className="text-xs text-muted">Ratings can be changed for the last 30 days.</p>}
      {error && <p role="alert" className="text-xs text-no">{error}</p>}
      {editable && <Link href={`/checkin?date=${date}`} className="inline-block text-xs font-semibold text-lime underline">Notes and journal for this day</Link>}
    </div>
  );
}

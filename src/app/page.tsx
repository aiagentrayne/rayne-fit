"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fromCache } from "@/client/api";
import { cacheGet, cacheSet, enqueue, readOutbox } from "@/client/offline";
import { fmtDate, fmtInstant, fmtTime, KIND_LABEL } from "@/client/format";
import type { Dashboard, DayItem } from "@/client/types";
import { SyncPill, useShell } from "@/components/AppShell";
import { PeriodCard } from "@/components/PeriodCard";
import { ScoreRing } from "@/components/ScoreRing";
import { Wordmark } from "@/components/Wordmark";
import { NuggetCard } from "@/components/coach/NuggetCard";
import { CoachPrompts, DailyReviewCard, PeriodMeasurables } from "@/components/coach/TodayCoach";
import { scoreDay } from "@/lib/core/scoring";

type Answer = "yes" | "no" | null;

export default function TodayPage() {
  const { version, syncNow, refreshPending, lastSyncIssues, online } = useShell();
  const [data, setData] = useState<Dashboard | null>(null);
  const [overlay, setOverlay] = useState<Record<string, Answer>>({});
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const [focusNugget, setFocusNugget] = useState(false);

  const load = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/dashboard?tz=${encodeURIComponent(tz)}`, { credentials: "same-origin" });
      if (res.status === 401) location.href = "/login";
      if (!res.ok) throw new Error(`Couldn't load today (${res.status})`);
      const d = (await res.json()) as Dashboard;
      setData(d);
      // The service worker answers from its cache when the network is down.
      setStale(fromCache(res));
      setError(null);
      if (!fromCache(res)) await cacheSet("dashboard", d);
    } catch (e) {
      const cached = await cacheGet<Dashboard>("dashboard");
      if (cached) {
        setData((cur) => cur ?? cached);
        setStale(true);
      } else setError((e as Error).message);
    }
    // Answers still waiting in the outbox override what the server last told us.
    const pending = await readOutbox();
    setOverlay(Object.fromEntries(pending.map((m) => [`${m.date}|${m.itemId}`, m.value])));
  }, []);

  useEffect(() => {
    void cacheGet<Dashboard>("dashboard").then((c) => c && setData((cur) => cur ?? c));
    const p = new URLSearchParams(location.search);
    setFocusItem(p.get("item"));
    setFocusNugget(p.get("nugget") === "1");
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load, version]);

  const items: DayItem[] = useMemo(() => {
    if (!data) return [];
    return data.today.items.map((i) => {
      const k = `${data.today.date}|${i.itemId}`;
      return k in overlay ? { ...i, response: overlay[k] } : i;
    });
  }, [data, overlay]);

  const live = useMemo(() => scoreDay(items.map((i) => i.response), data?.settings.gradeThresholds), [items, data]);
  const isOpen = data ? data.today.status === "open" && Date.now() < Date.parse(data.today.cutoffAt) : false;

  async function answer(item: DayItem, value: Answer) {
    if (!data || !isOpen) return;
    const next = item.response === value ? null : value; // tapping the selected answer clears it
    setOverlay((o) => ({ ...o, [`${data.today.date}|${item.itemId}`]: next }));
    await enqueue(data.today.date, item.itemId, next);
    await refreshPending();
    if (navigator.vibrate) navigator.vibrate(10);
    await syncNow();
  }

  if (error && !data) {
    return (
      <div className="pt-16 text-center">
        <Wordmark />
        <p className="mt-8 text-muted">{online ? error : "You're offline and nothing is cached on this device yet."}</p>
        <button className="mt-4 rounded-xl bg-lime px-5 py-3 font-bold text-ink" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const tz = data.settings.timezone;
  const answered = live.yes + live.no;
  const prefs = data.settings.dashboardPrefs;
  const groups = prefs.groupByCategory ? groupBy(items, (i) => i.category ?? "Other") : [["", items] as const];

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between pt-2">
        <Wordmark size="sm" />
        <SyncPill />
      </header>

      <div>
        <p className="text-sm text-muted">{fmtDate(data.today.date)}</p>
        {stale && <p className="mt-1 text-xs text-orange">Showing the last saved copy. Answers you tap are kept on this device and sync when you're back online.</p>}
      </div>

      <ScoreRing pct={live.pct} grade={live.grade} label="Today" sub={isOpen ? "Live" : "Final"} size={210} />

      <p className="text-center text-sm" aria-live="polite">
        <strong>{answered}</strong> of {live.applicable} answered · <strong>{live.pending}</strong> remaining
        <span className="block text-xs text-muted">
          {isOpen ? `Unanswered items count as NO at ${fmtInstant(data.today.cutoffAt, tz)}` : "This day is closed. Corrections are made from History."}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <PeriodCard title="This week" period={data.week} />
        <PeriodCard title="This month" period={data.month} />
      </div>

      {data.coach && <CoachPrompts coach={data.coach} tz={tz} />}
      {data.coach?.nugget && <NuggetCard nugget={data.coach.nugget} highlight={focusNugget} />}

      <ReminderStatus data={data} />

      {lastSyncIssues.length > 0 && (
        <div role="alert" className="rounded-xl border border-orange bg-orange/10 p-3 text-sm">
          {lastSyncIssues.length} answer{lastSyncIssues.length > 1 ? "s" : ""} couldn&apos;t be applied (the day had closed, or a newer answer already existed). The list shows what the server kept.
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-concrete p-6 text-center">
          <p className="font-semibold">Nothing scheduled today.</p>
          <p className="mt-1 text-sm text-muted">Days with no scheduled items are N/A and don&apos;t affect your grades.</p>
          <Link href="/items/new" className="mt-4 inline-block rounded-xl bg-lime px-5 py-3 font-bold text-ink">
            Add a commitment
          </Link>
        </div>
      ) : (
        groups.map(([group, list]) => (
          <section key={group} aria-label={group || "Today's items"}>
            {group && <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">{group}</h2>}
            <ul className="space-y-3">
              {list.map((item) => (
                <ItemRow key={item.itemId} item={item} open={isOpen} highlight={item.itemId === focusItem} showCategory={prefs.showCategories && !prefs.groupByCategory} onAnswer={answer} />
              ))}
            </ul>
          </section>
        ))
      )}

      {data.coach && <PeriodMeasurables date={data.today.date} items={data.coach.periods} open={!stale} onChange={() => void load()} />}

      {data.coach && <DailyReviewCard date={data.today.date} review={data.coach.review} open={!stale} onChange={() => void load()} />}

      <div className="flex justify-center gap-3 pt-2 text-sm">
        <Link href="/items/new" className="rounded-xl border border-concrete px-4 py-2 font-semibold">
          + Add item
        </Link>
        <Link href="/items" className="rounded-xl border border-concrete px-4 py-2 font-semibold">
          Edit / reorder
        </Link>
      </div>
    </div>
  );
}

function ItemRow({ item, open, highlight, showCategory, onAnswer }: { item: DayItem; open: boolean; highlight: boolean; showCategory: boolean; onAnswer: (i: DayItem, v: Answer) => void }) {
  const state = item.response === "yes" ? "YES" : item.response === "no" ? "NO" : "Pending";
  const border = item.response === "yes" ? "border-yes" : item.response === "no" ? "border-no" : "border-panel-2";
  return (
    <li className={`rounded-2xl border-2 ${border} bg-panel p-3 ${highlight ? "ring-2 ring-hardhat" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{item.name}</p>
          <p className="text-xs text-muted">
            {item.dueTime && <span>Due {fmtTime(item.dueTime)}</span>}
            {item.dueTime && showCategory && item.category && " · "}
            {showCategory && item.category && <span>{item.category}</span>}
            {item.autoFinalized && <span> · Auto-NO at cutoff</span>}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${item.response === "yes" ? "bg-yes text-ink" : item.response === "no" ? "bg-no text-ink" : "border border-concrete text-muted"}`}
        >
          {state}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!open}
          aria-pressed={item.response === "yes"}
          aria-label={`Mark ${item.name} YES`}
          onClick={() => onAnswer(item, "yes")}
          className={`min-h-14 rounded-xl text-lg font-black transition ${item.response === "yes" ? "bg-yes text-ink" : "border-2 border-yes/60 text-yes"} disabled:opacity-50`}
        >
          ✓ YES
        </button>
        <button
          type="button"
          disabled={!open}
          aria-pressed={item.response === "no"}
          aria-label={`Mark ${item.name} NO`}
          onClick={() => onAnswer(item, "no")}
          className={`min-h-14 rounded-xl text-lg font-black transition ${item.response === "no" ? "bg-no text-ink" : "border-2 border-no/60 text-no"} disabled:opacity-50`}
        >
          ✕ NO
        </button>
      </div>
    </li>
  );
}

function ReminderStatus({ data }: { data: Dashboard }) {
  const tz = data.settings.timezone;
  const pushOff = !data.settings.notificationsEnabled;
  const noDevice = data.pushSubscriptions === 0;
  return (
    <section className="space-y-2" aria-label="Reminders">
      {data.dueReminders.map((r) => (
        <div key={r.id} role="status" className="flex items-center gap-3 rounded-xl bg-hardhat/15 p-3 text-sm">
          <span aria-hidden="true">⏰</span>
          <span>
            <strong>{r.title}</strong> is still waiting. Have you done it?
            <span className="block text-xs text-muted">
              {KIND_LABEL[r.kind] ?? "Reminder"} at {fmtInstant(r.scheduledFor, tz)}
            </span>
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-xl bg-panel px-3 py-2 text-sm">
        <span>
          {data.nextReminder ? (
            <>
              Next: <strong>{data.nextReminder.title}</strong> · {KIND_LABEL[data.nextReminder.kind] ?? "Reminder"} at {fmtInstant(data.nextReminder.scheduledFor, tz)}
            </>
          ) : (
            <span className="text-muted">No more reminders scheduled today</span>
          )}
        </span>
        {(pushOff || noDevice) && (
          <Link href="/settings#notifications" className="ml-2 shrink-0 text-xs font-semibold text-orange underline">
            {pushOff ? "Notifications off" : "In-app only"}
          </Link>
        )}
      </div>
    </section>
  );
}

function groupBy<T>(list: T[], key: (t: T) => string): (readonly [string, T[]])[] {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.entries()];
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5 pt-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-32 rounded bg-panel" />
      <div className="mx-auto h-52 w-52 rounded-full bg-panel" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-28 rounded-2xl bg-panel" />
        <div className="h-28 rounded-2xl bg-panel" />
      </div>
      <div className="h-32 rounded-2xl bg-panel" />
    </div>
  );
}

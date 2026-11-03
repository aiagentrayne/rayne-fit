"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { currentDeviceSubscribed, disablePushOnThisDevice, enablePush, isIOS, permission, pushSupport } from "@/client/push";
import type { Settings } from "@/client/types";
import { Toggle } from "@/components/ItemForm";
import { DEFAULT_GRADE_THRESHOLDS, validateThresholds, type GradeThreshold } from "@/lib/core/grading";

const input = "w-full rounded-xl border border-concrete bg-ink px-3 py-3 text-base text-white";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings").then((r) => setS(r.settings), (e) => setError(e.message));
  }, []);

  async function patch(p: Partial<Settings>) {
    setError(null);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PATCH", json: p });
      setS(r.settings);
      setSaved("Saved");
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!s) return <p className="pt-6 text-muted">{error ?? "Loading settings…"}</p>;
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [s.timezone];

  return (
    <div className="space-y-6 pt-2">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Settings</h1>
        <span aria-live="polite" className="text-sm text-lime">{saved}</span>
      </header>
      {error && <p role="alert" className="rounded-xl border border-no p-3 text-sm text-no">{error}</p>}

      <Notifications s={s} patch={patch} />

      <CheckinSettings s={s} patch={patch} />

      <RossSettings s={s} patch={patch} reload={async () => setS((await api<{ settings: Settings }>("/api/settings")).settings)} />

      <Section title="Day & week">
        <Field label="Time zone" id="tz">
          <select id="tz" className={input} value={s.timezone} onChange={(e) => void patch({ timezone: e.target.value })}>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Daily cutoff" id="cutoff" hint="Unanswered items become NO at this time. Times before noon close the day the next morning (for late nights). A change applies to today only if the new cutoff hasn't passed yet.">
          <input id="cutoff" type="time" className={input} defaultValue={s.cutoffTime} onBlur={(e) => e.target.value && e.target.value !== s.cutoffTime && void patch({ cutoffTime: e.target.value })} />
        </Field>
        <Field label="Week starts on" id="ws">
          <select id="ws" className={input} value={s.weekStart} onChange={(e) => void patch({ weekStart: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
        </Field>
      </Section>

      <Grading thresholds={s.gradeThresholds} onSave={(t) => patch({ gradeThresholds: t })} />

      <Section title="Dashboard">
        <Toggle id="showcat" checked={s.dashboardPrefs.showCategories} onChange={(b) => void patch({ dashboardPrefs: { ...s.dashboardPrefs, showCategories: b } })} label="Show categories on items" />
        <Toggle id="group" checked={s.dashboardPrefs.groupByCategory} onChange={(b) => void patch({ dashboardPrefs: { ...s.dashboardPrefs, groupByCategory: b } })} label="Group today's items by category" />
      </Section>

      <Section title="Your data">
        <p className="text-sm text-muted">Rayne Fit stores your account email, measurables, answers, check-ins, journal, settings and, if ROSS is on, your coaching data. No tracking or ads. <Link href="/privacy" className="underline">Privacy notice</Link></p>
        <a href="/api/export" className="inline-block rounded-xl border border-concrete px-4 py-2 text-sm font-semibold">Download my data (JSON)</a>
        <DeleteEverything />
        <SignOut />
      </Section>
    </div>
  );
}

function Notifications({ s, patch }: { s: Settings; patch: (p: Partial<Settings>) => Promise<void> }) {
  const [perm, setPerm] = useState<string>("default");
  const [support, setSupport] = useState<string>("supported");
  const [subscribed, setSubscribed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setPerm(permission());
    setSupport(pushSupport());
    void currentDeviceSubscribed().then(setSubscribed);
  }, []);

  async function enable() {
    const r = await enablePush();
    setMsg(r.message);
    setPerm(permission());
    setSubscribed(await currentDeviceSubscribed());
  }

  async function test() {
    const r = await api<{ status: string; reason: string | null }>("/api/push/test", { method: "POST" });
    setMsg(r.status === "sent" ? "Test sent. It should arrive in a few seconds." : `Not delivered: ${r.reason?.replace(/_/g, " ")}.`);
  }

  return (
    <Section title="Notifications" id="notifications">
      <Toggle id="master" checked={s.notificationsEnabled} onChange={(b) => void patch({ notificationsEnabled: b })} label="All reminders and nudges" hint="Master switch for every item." />
      <div className="rounded-xl bg-ink p-3 text-sm">
        <p>
          This device:{" "}
          <strong className={subscribed && perm === "granted" ? "text-lime" : "text-orange"}>
            {support === "needs-install" ? "Install to Home Screen first" : support === "unsupported" ? "Push not supported" : perm === "denied" ? "Blocked in settings" : subscribed ? "Push on" : "Push off"}
          </strong>
        </p>
        {support === "needs-install" && (
          <p className="mt-1 text-xs text-muted">
            iPhone and iPad only deliver web notifications to apps added to the Home Screen (iOS 16.4 or later). <Link href="/install" className="text-lime underline">How to install</Link>
          </p>
        )}
        {perm === "denied" && support === "supported" && <p className="mt-1 text-xs text-muted">Allow notifications for Rayne Fit in {isIOS() ? "Settings › Notifications › Rayne Fit" : "your browser's site settings"}, then come back.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {support === "supported" && !subscribed && perm !== "denied" && (
            <button onClick={() => void enable()} className="rounded-xl bg-lime px-4 py-2 font-bold text-ink">Enable notifications</button>
          )}
          {subscribed && (
            <>
              <button onClick={() => void test()} className="rounded-xl border border-lime px-4 py-2 font-semibold text-lime">Send test</button>
              <button onClick={() => void disablePushOnThisDevice().then(() => setSubscribed(false))} className="rounded-xl border border-concrete px-4 py-2 font-semibold">Turn off on this device</button>
            </>
          )}
        </div>
        {msg && <p className="mt-2 text-xs" role="status">{msg}</p>}
        <p className="mt-3 text-xs text-muted">
          Web notifications are not alarms: they can arrive a little late, don&apos;t ring continuously, and follow Silent Mode and Focus. When push is unavailable, reminders still show inside the app.
        </p>
      </div>

      <Toggle id="quiet" checked={s.quietHoursEnabled} onChange={(b) => void patch({ quietHoursEnabled: b })} label="Quiet hours" hint="Nothing is sent in this window." />
      {s.quietHoursEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" id="qs"><input id="qs" type="time" className={input} defaultValue={s.quietStart} onBlur={(e) => e.target.value && void patch({ quietStart: e.target.value })} /></Field>
          <Field label="To" id="qe"><input id="qe" type="time" className={input} defaultValue={s.quietEnd} onBlur={(e) => e.target.value && void patch({ quietEnd: e.target.value })} /></Field>
        </div>
      )}
      <Toggle id="evening" checked={s.eveningReminderEnabled} onChange={(b) => void patch({ eveningReminderEnabled: b })} label="Evening scorecard reminder" hint="Unanswered items plus your mood and stress check-in. Skipped when everything is done." />
      {s.eveningReminderEnabled && (
        <Field label="Evening reminder time" id="et"><input id="et" type="time" className={input} defaultValue={s.eveningReminderTime} onBlur={(e) => e.target.value && void patch({ eveningReminderTime: e.target.value })} /></Field>
      )}
      <Toggle id="weekly" checked={s.weeklySummaryEnabled} onChange={(b) => void patch({ weeklySummaryEnabled: b })} label="Weekly grade summary" hint="9:00 AM on the first day of the week." />
      <Toggle id="monthly" checked={s.monthlySummaryEnabled} onChange={(b) => void patch({ monthlySummaryEnabled: b })} label="Monthly grade summary" hint="9:00 AM on the 1st." />
      <p className="text-xs text-muted">Per-item reminder times and nudges are set on each item.</p>
    </Section>
  );
}

function CheckinSettings({ s, patch }: { s: Settings; patch: (p: Partial<Settings>) => Promise<void> }) {
  return (
    <Section title="Daily check-in" id="checkin">
      <p className="text-xs text-muted">Morning energy after waking, then mood and stress with the evening reminder. All three complete your daily review.</p>
      <Toggle id="checkin-rem" checked={s.checkinRemindersEnabled} onChange={(b) => void patch({ checkinRemindersEnabled: b })} label="Check-in reminders" hint="A morning reminder (and one follow-up if you haven't rated energy); the evening reminder asks for mood and stress." />
      {s.checkinRemindersEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Morning reminder" id="mct"><input id="mct" type="time" className={input} defaultValue={s.morningCheckinTime} onBlur={(e) => e.target.value && void patch({ morningCheckinTime: e.target.value })} /></Field>
          <Field label="Follow-up if missing" id="mft"><input id="mft" type="time" className={input} defaultValue={s.morningFollowupTime} onBlur={(e) => e.target.value && void patch({ morningFollowupTime: e.target.value })} /></Field>
        </div>
      )}
      {s.checkinRemindersEnabled && !s.eveningReminderEnabled && <p className="text-xs text-orange">The evening reminder is off, so you won&apos;t be reminded about mood and stress.</p>}
    </Section>
  );
}

function RossSettings({ s, patch, reload }: { s: Settings; patch: (p: Partial<Settings>) => Promise<void>; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function turnOff() {
    await api("/api/coach/enable", { method: "POST", json: { enabled: false } });
    await reload();
  }
  async function wipe() {
    if (!confirm("Delete your vision, milestones, interviews, commitments, nuggets and everything ROSS remembers? Your measurables, answers and check-ins stay. This can't be undone.")) return;
    await api("/api/coach/data", { method: "DELETE" });
    setMsg("Coaching data deleted and ROSS turned off.");
    await reload();
  }
  if (!s.rossEnabled) {
    return (
      <Section title="ROSS coach" id="ross">
        <p className="text-sm text-muted">ROSS is off. <Link href="/coach" className="text-lime underline">Turn it on</Link> to get a life vision, daily nuggets and weekly interviews.</p>
        {s.rossConsentAt && <button onClick={() => void wipe()} className="rounded-xl border border-no px-4 py-2 text-sm font-semibold text-no">Delete all coaching data</button>}
        {msg && <p role="status" className="text-xs text-lime">{msg}</p>}
      </Section>
    );
  }
  return (
    <Section title="ROSS coach" id="ross">
      <Toggle id="share-checkins" checked={s.rossShareCheckins} onChange={(b) => void patch({ rossShareCheckins: b })} label="Share check-in ratings with ROSS" hint="Energy, mood and stress, and their notes." />
      <Toggle id="share-journal" checked={s.rossShareJournal} onChange={(b) => void patch({ rossShareJournal: b })} label="Share journal entries with ROSS" hint="Last 7 days, used as context only." />

      <Toggle id="nugget" checked={s.nuggetEnabled} onChange={(b) => void patch({ nuggetEnabled: b })} label="Daily nugget" hint="One short message a day, at a varying time inside your window." />
      {s.nuggetEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Window from" id="nws"><input id="nws" type="time" className={input} defaultValue={s.nuggetWindowStart} onBlur={(e) => e.target.value && void patch({ nuggetWindowStart: e.target.value })} /></Field>
          <Field label="To" id="nwe"><input id="nwe" type="time" className={input} defaultValue={s.nuggetWindowEnd} onBlur={(e) => e.target.value && void patch({ nuggetWindowEnd: e.target.value })} /></Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Weekly interview day" id="wid">
          <select id="wid" className={input} value={s.weeklyInterviewDow} onChange={(e) => void patch({ weeklyInterviewDow: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
        </Field>
        <Field label="Time" id="wit"><input id="wit" type="time" className={input} defaultValue={s.weeklyInterviewTime} onBlur={(e) => e.target.value && void patch({ weeklyInterviewTime: e.target.value })} /></Field>
      </div>
      <Toggle id="monthly-int" checked={s.monthlyInterviewEnabled} onChange={(b) => void patch({ monthlyInterviewEnabled: b })} label="Monthly progress interview" hint="Replaces the weekly interview on the first one of each month (20–30 min)." />
      <Toggle id="quarterly" checked={s.quarterlyReviewEnabled} onChange={(b) => void patch({ quarterlyReviewEnabled: b })} label="Quarterly vision review" hint="Offered every 90 days after you set your vision." />

      <Field label="Most ROSS notifications per day" id="cap" hint="Counts the nugget and interview reminders. Interview reminders come first; the nugget is still on Today if its push is skipped.">
        <select id="cap" className={input} value={s.rossMaxDailyNotifications} onChange={(e) => void patch({ rossMaxDailyNotifications: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
      <p className="text-sm font-semibold">ROSS quiet hours</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" id="rqs"><input id="rqs" type="time" className={input} defaultValue={s.rossQuietStart} onBlur={(e) => e.target.value && void patch({ rossQuietStart: e.target.value })} /></Field>
        <Field label="To" id="rqe"><input id="rqe" type="time" className={input} defaultValue={s.rossQuietEnd} onBlur={(e) => e.target.value && void patch({ rossQuietEnd: e.target.value })} /></Field>
      </div>
      <p className="-mt-2 text-xs text-muted">Coaching reminders that would land in this window wait until it ends.</p>

      <div className="flex flex-wrap gap-2 pt-2">
        <Link href="/coach/memory" className="rounded-xl border border-concrete px-4 py-2 text-sm font-semibold">What ROSS knows</Link>
        <button onClick={() => void turnOff()} className="rounded-xl border border-concrete px-4 py-2 text-sm font-semibold">Turn ROSS off</button>
        <button onClick={() => void wipe()} className="rounded-xl border border-no px-4 py-2 text-sm font-semibold text-no">Delete all coaching data</button>
      </div>
      {msg && <p role="status" className="text-xs text-lime">{msg}</p>}
    </Section>
  );
}

function DeleteEverything() {
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  async function wipe() {
    await api("/api/account/data", { method: "DELETE" });
    await api("/api/auth/signout", { method: "POST" }).catch(() => {});
    try {
      indexedDB.deleteDatabase("keyval-store");
    } catch {}
    location.href = "/login";
  }
  if (!confirming) {
    return <button onClick={() => setConfirming(true)} className="block rounded-xl border border-no/60 px-4 py-2 text-sm font-semibold text-no">Delete all my data…</button>;
  }
  return (
    <div className="space-y-2 rounded-xl border border-no p-3 text-sm">
      <p>This permanently deletes every Rayne Fit record for your account: measurables, answers, grades, check-ins, journal and coaching data. Download your data first if you want a copy. Type <strong>DELETE</strong> to confirm.</p>
      <input className={input} value={text} onChange={(e) => setText(e.target.value)} aria-label="Type DELETE to confirm" />
      <div className="flex gap-2">
        <button disabled={text !== "DELETE"} onClick={() => void wipe()} className="rounded-xl bg-no px-4 py-2 font-bold text-ink disabled:opacity-40">Delete everything</button>
        <button onClick={() => setConfirming(false)} className="rounded-xl border border-concrete px-4 py-2 font-semibold">Cancel</button>
      </div>
    </div>
  );
}

function Grading({ thresholds, onSave }: { thresholds: GradeThreshold[]; onSave: (t: GradeThreshold[]) => Promise<void> }) {
  const [rows, setRows] = useState(thresholds);
  const err = validateThresholds(rows);
  const dirty = JSON.stringify(rows) !== JSON.stringify(thresholds);
  return (
    <Section title="Grading scale">
      <p className="text-xs text-muted">Grades compare against the exact (unrounded) percentage.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="pb-1">Grade</th>
            <th className="pb-1">Minimum %</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <input aria-label={`Grade ${i + 1} label`} className="w-16 rounded-lg border border-concrete bg-ink px-2 py-1.5" value={r.grade} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))} />
              </td>
              <td className="py-1 pr-2">
                <input aria-label={`Minimum for ${r.grade}`} type="number" step="0.1" min={0} max={100} className="w-24 rounded-lg border border-concrete bg-ink px-2 py-1.5" value={r.min} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} />
              </td>
              <td className="py-1 text-right">
                <button className="text-xs text-muted underline" aria-label={`Remove ${r.grade}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg border border-concrete px-3 py-1.5 text-xs font-semibold" onClick={() => setRows([...rows.slice(0, -1), { grade: "?", min: Math.max(0, (rows[rows.length - 2]?.min ?? 50) - 5) }, rows[rows.length - 1]])}>+ Add grade</button>
        <button className="rounded-lg border border-concrete px-3 py-1.5 text-xs font-semibold" onClick={() => setRows(DEFAULT_GRADE_THRESHOLDS)}>Reset to default</button>
        <button disabled={!dirty || Boolean(err)} className="rounded-lg bg-lime px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-40" onClick={() => void onSave(rows)}>Save scale</button>
      </div>
      {err && dirty && <p className="text-xs text-orange">{err}</p>}
    </Section>
  );
}

function SignOut() {
  async function signOut() {
    try {
      await disablePushOnThisDevice().catch(() => {});
      await api("/api/auth/signout", { method: "POST" });
    } finally {
      // Remove this user's cached data from the device.
      const reg = await navigator.serviceWorker?.getRegistration();
      reg?.active?.postMessage("CLEAR_USER_CACHE");
      try {
        indexedDB.deleteDatabase("keyval-store");
      } catch {}
      location.href = "/login";
    }
  }
  return (
    <button onClick={() => void signOut()} className="block rounded-xl border border-no px-4 py-2 text-sm font-semibold text-no">
      Sign out
    </button>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 rounded-2xl bg-panel p-4" aria-labelledby={`${title}-h`}>
      <h2 id={`${title}-h`} className="font-display text-xl">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import type { Item } from "@/client/types";
import { DEFAULT_ITEM_RULES, NUDGE_PRESETS, nudgeOffsetsEvery, type ItemNotificationRules } from "@/lib/core/reminders";
import type { Cadence, ScheduleType } from "@/lib/core/schedule";

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

const input = "w-full rounded-xl border border-concrete bg-ink px-3 py-3 text-base text-white placeholder:text-concrete";
const label = "mb-1 block text-sm font-semibold";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Detects whether offsets are a regular "every N minutes × M" pattern. */
function asInterval(offsets: number[]): { every: number; count: number } | null {
  if (!offsets.length) return null;
  const every = offsets[0];
  return offsets.every((o, i) => o === every * (i + 1)) ? { every, count: offsets.length } : null;
}

export function ItemForm({ item }: { item?: Item }) {
  const router = useRouter();
  const v = item?.current;
  const [name, setName] = useState(v?.name ?? "");
  const [description, setDescription] = useState(v?.description ?? "");
  const [category, setCategory] = useState(v?.category ?? "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(v?.scheduleType ?? "daily");
  const [days, setDays] = useState<number[]>(v?.daysOfWeek ?? []);
  const [startDate, setStartDate] = useState(v?.startDate ?? todayLocal());
  const [endDate, setEndDate] = useState(v?.endDate ?? "");
  const [dueTime, setDueTime] = useState(v?.dueTime ?? "");
  const [rules, setRules] = useState<ItemNotificationRules>(item?.rules ?? { ...DEFAULT_ITEM_RULES });
  const [cadence, setCadence] = useState<Cadence>(v?.cadence ?? "daily");
  const [targetCount, setTargetCount] = useState<number>(v?.targetCount ?? 3);
  const [milestoneId, setMilestoneId] = useState<string>(v?.milestoneId ?? "");
  const [milestones, setMilestones] = useState<{ id: string; title: string; status: string }[]>([]);
  useEffect(() => {
    api<{ milestones: { id: string; title: string; status: string }[] }>("/api/coach/milestones").then((r) => setMilestones(r.milestones), () => {});
  }, []);
  const initialInterval = asInterval(rules.nudgeOffsets);
  const [nudgeMode, setNudgeMode] = useState<"none" | "interval" | "custom">(rules.nudgeOffsets.length === 0 ? "none" : initialInterval ? "interval" : "custom");
  const [every, setEvery] = useState(initialInterval?.every ?? 15);
  const [count, setCount] = useState(initialInterval?.count ?? 3);
  const [customOffsets, setCustomOffsets] = useState(rules.nudgeOffsets.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRule = <K extends keyof ItemNotificationRules>(k: K, val: ItemNotificationRules[K]) => setRules((r) => ({ ...r, [k]: val }));

  function nudgeOffsets(): number[] {
    if (nudgeMode === "none") return [];
    if (nudgeMode === "interval") return nudgeOffsetsEvery(every, count);
    return customOffsets
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name,
      description: description || null,
      category: category || null,
      scheduleType: cadence === "daily" ? scheduleType : "daily",
      daysOfWeek: cadence === "daily" ? days : [],
      startDate,
      endDate: endDate || null,
      dueTime: cadence === "daily" ? dueTime || null : null,
      cadence,
      targetCount: cadence === "daily" ? null : targetCount,
      milestoneId: milestoneId || null,
      rules: { ...rules, nudgeOffsets: nudgeOffsets(), customMessage: rules.customMessage || null },
    };
    try {
      if (item) await api(`/api/items/${item.id}`, { method: "PUT", json: payload });
      else await api("/api/items", { method: "POST", json: payload });
      router.push("/items");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const anchorMissing = nudgeMode !== "none" && rules.reminderTimes.length === 0 && !dueTime;

  return (
    <form onSubmit={save} className="space-y-6">
      <fieldset className="space-y-4">
        <div>
          <label className={label} htmlFor="name">Name</label>
          <input id="name" className={input} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Exercise" />
        </div>
        <div>
          <label className={label} htmlFor="category">Category <span className="font-normal text-muted">(optional)</span></label>
          <input id="category" className={input} maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Health" />
        </div>
        <div>
          <label className={label} htmlFor="description">Description <span className="font-normal text-muted">(optional)</span></label>
          <textarea id="description" className={input} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-2xl bg-panel p-4">
        <legend className="font-display px-1 text-lg">Schedule</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How it's tracked">
          {(["daily", "weekly", "monthly"] as const).map((c) => (
            <button type="button" role="radio" aria-checked={cadence === c} key={c} onClick={() => setCadence(c)} className={`rounded-xl py-2 text-sm font-semibold ${cadence === c ? "bg-hardhat text-ink" : "border border-concrete"}`}>
              {c === "daily" ? "On set days" : c === "weekly" ? "Per week" : "Per month"}
            </button>
          ))}
        </div>
        {cadence !== "daily" ? (
          <div>
            <label className={label} htmlFor="target">Times per {cadence === "weekly" ? "week" : "month"}</label>
            <input id="target" type="number" min={1} max={cadence === "weekly" ? 7 : 31} className={input} value={targetCount} onChange={(e) => setTargetCount(Math.max(1, Math.min(cadence === "weekly" ? 7 : 31, Number(e.target.value) || 1)))} />
            <p className="mt-1 text-xs text-muted">Log it on Today whenever you do it. It&apos;s graded for the {cadence === "weekly" ? "week" : "month"} as a whole and never changes your daily score.</p>
          </div>
        ) : (
        <>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Repeats">
          {(["daily", "weekdays", "weekends", "custom"] as const).map((t) => (
            <button
              type="button"
              role="radio"
              aria-checked={scheduleType === t}
              key={t}
              onClick={() => setScheduleType(t)}
              className={`rounded-xl py-2 font-semibold capitalize ${scheduleType === t ? "bg-lime text-ink" : "border border-concrete"}`}
            >
              {t === "custom" ? "Pick days" : t}
            </button>
          ))}
        </div>
        {scheduleType === "custom" && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Days of week">
            {DAYS.map(([d, n]) => (
              <button
                type="button"
                key={d}
                aria-pressed={days.includes(d)}
                onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                className={`h-11 w-12 rounded-xl font-semibold ${days.includes(d) ? "bg-lime text-ink" : "border border-concrete"}`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="start">Starts</label>
            <input id="start" type="date" className={input} required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="end">Ends <span className="font-normal text-muted">(optional)</span></label>
            <input id="end" type="date" className={input} value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        {cadence === "daily" && (
          <div>
            <label className={label} htmlFor="due">Due time <span className="font-normal text-muted">(optional)</span></label>
            <input id="due" type="time" className={input} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
        )}
        {milestones.some((m) => m.status === "active" || m.id === milestoneId) && (
          <div>
            <label className={label} htmlFor="milestone">Supports milestone <span className="font-normal text-muted">(optional)</span></label>
            <select id="milestone" className={input} value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
              <option value="">None</option>
              {milestones.filter((m) => m.status === "active" || m.id === milestoneId).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </div>
        )}
        {item && <p className="text-xs text-muted">Changes apply from today. Past days keep the version they were scored with.</p>}
      </fieldset>

      {cadence === "daily" && (
      <fieldset className="space-y-4 rounded-2xl bg-panel p-4">
        <legend className="font-display px-1 text-lg">Reminders &amp; nudges</legend>
        <Toggle id="rules-enabled" checked={rules.enabled} onChange={(b) => setRule("enabled", b)} label="Reminders for this item" />
        {rules.enabled && (
          <>
            <div>
              <span className={label}>Reminder times</span>
              <ul className="space-y-2">
                {rules.reminderTimes.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <input
                      type="time"
                      aria-label={`Reminder ${i + 1}`}
                      className={input}
                      value={t}
                      onChange={(e) => setRule("reminderTimes", rules.reminderTimes.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <button type="button" className="rounded-xl border border-concrete px-3" aria-label={`Remove reminder ${i + 1}`} onClick={() => setRule("reminderTimes", rules.reminderTimes.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="mt-2 text-sm font-semibold text-lime" onClick={() => setRule("reminderTimes", [...rules.reminderTimes, "08:00"])}>
                + Add reminder time
              </button>
            </div>

            {dueTime && (
              <div>
                <label className={label} htmlFor="beforedue">Remind before due time (minutes)</label>
                <input
                  id="beforedue"
                  className={input}
                  inputMode="numeric"
                  placeholder="e.g. 60, 15"
                  defaultValue={rules.beforeDueMinutes.join(", ")}
                  onBlur={(e) => setRule("beforeDueMinutes", e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))}
                />
              </div>
            )}

            <div>
              <span className={label}>Follow-up nudges until you answer</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Nudges">
                {(["none", "interval", "custom"] as const).map((m) => (
                  <button type="button" role="radio" aria-checked={nudgeMode === m} key={m} onClick={() => setNudgeMode(m)} className={`rounded-xl py-2 text-sm font-semibold ${nudgeMode === m ? "bg-lime text-ink" : "border border-concrete"}`}>
                    {m === "none" ? "Off" : m === "interval" ? "Repeat" : "Custom"}
                  </button>
                ))}
              </div>
              {nudgeMode === "interval" && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className={label} htmlFor="every">Every</label>
                    <select id="every" className={input} value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                      {[...NUDGE_PRESETS, 45, 90, 120].sort((a, b) => a - b).map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor="count">Max nudges</label>
                    <input id="count" type="number" min={1} max={24} className={input} value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} />
                  </div>
                </div>
              )}
              {nudgeMode === "custom" && (
                <div className="mt-3">
                  <label className={label} htmlFor="offsets">Minutes after the first reminder</label>
                  <input id="offsets" className={input} value={customOffsets} onChange={(e) => setCustomOffsets(e.target.value)} placeholder="15, 30, 60" />
                </div>
              )}
              {anchorMissing && <p className="mt-2 text-xs text-orange">Nudges start from the first reminder time (or the due time). Add one so nudges have a starting point.</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="deadline">Deadline warning</label>
                <select id="deadline" className={input} value={rules.deadlineWarningMinutes ?? 0} onChange={(e) => setRule("deadlineWarningMinutes", Number(e.target.value) || null)}>
                  <option value={0}>Off</option>
                  {[10, 15, 30, 45, 60, 120].map((m) => (
                    <option key={m} value={m}>
                      {m} min before
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="snooze">Snooze for</label>
                <select id="snooze" className={input} value={rules.snoozeMinutes} onChange={(e) => setRule("snoozeMinutes", Number(e.target.value))}>
                  {[5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted">The deadline is the due time if set, otherwise the daily cutoff.</p>

            <Toggle id="reconsider" checked={rules.reconsiderAfterNo} onChange={(b) => setRule("reconsiderAfterNo", b)} label="Keep nudging after a NO (until the deadline)" />

            <div>
              <label className={label} htmlFor="msg">Custom reminder message <span className="font-normal text-muted">(optional)</span></label>
              <input id="msg" className={input} maxLength={200} value={rules.customMessage ?? ""} onChange={(e) => setRule("customMessage", e.target.value)} placeholder={`Time to ${name ? name[0].toLowerCase() + name.slice(1) : "exercise"}.`} />
            </div>
          </>
        )}
      </fieldset>
      )}

      {error && <p role="alert" className="rounded-xl border border-no p-3 text-sm text-no">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-lime py-4 text-lg font-black text-ink disabled:opacity-60">
          {saving ? "Saving…" : item ? "Save changes" : "Add item"}
        </button>
        <button type="button" onClick={() => router.back()} className="rounded-xl border border-concrete px-5 font-semibold">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (b: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? "bg-lime" : "bg-concrete"}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-ink transition-all ${checked ? "left-7" : "left-1"}`} />
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

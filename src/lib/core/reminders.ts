import { cutoffInstant, type DayClock } from "./days";
import { addMinutes, localTimeOf, minutesOf, zonedInstant, type LocalDate, type LocalTime } from "./time";
import type { ResponseValue } from "./scoring";

export type NotificationKind =
  | "reminder"
  | "nudge"
  | "deadline"
  | "snooze"
  | "evening"
  | "weekly_summary"
  | "monthly_summary"
  | "test";

export const NUDGE_PRESETS = [5, 10, 15, 30, 60] as const;

/** Per-item notification rules, editable in the app without code. */
export interface ItemNotificationRules {
  enabled: boolean;
  /** Reminder alarms at fixed local times, e.g. ["06:00"]. */
  reminderTimes: LocalTime[];
  /** Reminders N minutes before the item's due time. */
  beforeDueMinutes: number[];
  /** Follow-up nudges, minutes after the first reminder (e.g. [15, 30, 60]). */
  nudgeOffsets: number[];
  /** Final warning N minutes before the deadline (due time, or the daily cutoff). */
  deadlineWarningMinutes: number | null;
  snoozeMinutes: number;
  /** After a NO, keep nudging until the deadline in case the user changes their mind. */
  reconsiderAfterNo: boolean;
  customMessage: string | null;
}

export const DEFAULT_ITEM_RULES: ItemNotificationRules = {
  enabled: true,
  reminderTimes: [],
  beforeDueMinutes: [],
  nudgeOffsets: [],
  deadlineWarningMinutes: null,
  snoozeMinutes: 10,
  reconsiderAfterNo: false,
  customMessage: null,
};

export interface GlobalNotificationSettings extends DayClock {
  notificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStart: LocalTime;
  quietEnd: LocalTime;
  eveningReminderEnabled: boolean;
  eveningReminderTime: LocalTime;
  weeklySummaryEnabled: boolean;
  monthlySummaryEnabled: boolean;
  weekStart: number;
}

export interface PlannableItem {
  itemId: string;
  name: string;
  dueTime: LocalTime | null;
  rules: ItemNotificationRules;
  /** After a NO with reconsideration on: keep follow-up nudges/deadline, skip the "time to" reminders. */
  followUpsOnly?: boolean;
}

export interface PlannedNotification {
  /** Stable key: re-planning the same day never creates a duplicate. */
  dedupeKey: string;
  kind: NotificationKind;
  itemId: string | null;
  localDate: LocalDate;
  scheduledFor: Date;
  title: string;
  body: string;
}

/** Expand "every N minutes, up to M times" into explicit offsets. */
export function nudgeOffsetsEvery(intervalMinutes: number, maxNudges: number): number[] {
  if (intervalMinutes <= 0 || maxNudges <= 0) return [];
  return Array.from({ length: maxNudges }, (_, i) => intervalMinutes * (i + 1));
}

function lcFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

export const messages = {
  reminder: (name: string, custom: string | null) => custom?.trim() || `Time to ${lcFirst(name)}.`,
  nudge: (name: string) => `${name} is still waiting. Have you done it?`,
  deadline: (name: string, minutes: number) => `${minutes} minutes left for your ${lcFirst(name)} goal.`,
  evening: (count: number) => `You have ${count} unanswered item${count === 1 ? "" : "s"} today.`,
};

function key(userId: string, date: LocalDate, itemId: string | null, kind: NotificationKind, at: Date): string {
  return `${userId}|${date}|${itemId ?? "-"}|${kind}|${at.toISOString()}`;
}

/**
 * Plans every notification for one user-day. Pure and deterministic: given the same
 * configuration it returns the same dedupe keys, so a scheduler can call it repeatedly.
 * Validity (answered, quiet hours, master switch) is re-checked at send time by `decideSend`.
 */
export function planDay(userId: string, date: LocalDate, items: PlannableItem[], settings: GlobalNotificationSettings): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const cutoff = cutoffInstant(date, settings);
  const tz = settings.timezone;
  const push = (n: Omit<PlannedNotification, "dedupeKey" | "localDate">) => {
    if (n.scheduledFor.getTime() >= cutoff.getTime()) return; // never after the day closes
    out.push({ ...n, localDate: date, dedupeKey: key(userId, date, n.itemId, n.kind, n.scheduledFor) });
  };

  for (const item of items) {
    const r = item.rules;
    if (!r.enabled) continue;
    const due = item.dueTime ? zonedInstant(date, item.dueTime, tz) : null;
    const reminderInstants = new Map<number, Date>();
    for (const t of r.reminderTimes) {
      const at = zonedInstant(date, t, tz);
      reminderInstants.set(at.getTime(), at);
    }
    if (due) {
      for (const m of r.beforeDueMinutes) {
        if (m <= 0) continue;
        const at = addMinutes(due, -m);
        reminderInstants.set(at.getTime(), at);
      }
    }
    const reminders = [...reminderInstants.values()].sort((a, b) => a.getTime() - b.getTime());
    for (const at of item.followUpsOnly ? [] : reminders) {
      push({ kind: "reminder", itemId: item.itemId, scheduledFor: at, title: item.name, body: messages.reminder(item.name, r.customMessage) });
    }

    // Nudges are anchored to the first reminder, or to the due time when there is no reminder.
    const anchor = reminders[0] ?? due;
    if (anchor) {
      const offsets = [...new Set(r.nudgeOffsets.filter((m) => m > 0))].sort((a, b) => a - b);
      for (const m of offsets) {
        push({ kind: "nudge", itemId: item.itemId, scheduledFor: addMinutes(anchor, m), title: item.name, body: messages.nudge(item.name) });
      }
    }

    if (r.deadlineWarningMinutes && r.deadlineWarningMinutes > 0) {
      const deadline = due ?? cutoff;
      push({
        kind: "deadline",
        itemId: item.itemId,
        scheduledFor: addMinutes(deadline, -r.deadlineWarningMinutes),
        title: item.name,
        body: messages.deadline(item.name, r.deadlineWarningMinutes),
      });
    }
  }

  if (settings.eveningReminderEnabled && items.length > 0) {
    // Body is rewritten at send time with the live unanswered count.
    push({ kind: "evening", itemId: null, scheduledFor: zonedInstant(date, settings.eveningReminderTime, tz), title: "Scorecard check-in", body: "" });
  }
  return out;
}

export interface SendState {
  now: Date;
  notificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStart: LocalTime;
  quietEnd: LocalTime;
  timezone: string;
  dayFinal: boolean;
  /** For item notifications. */
  itemScheduled?: boolean;
  itemRulesEnabled?: boolean;
  response?: ResponseValue;
  reconsiderAfterNo?: boolean;
  /** For evening reminders. */
  unansweredCount?: number;
}

export type SendDecision =
  | { action: "send" }
  | { action: "cancel"; reason: string }
  | { action: "suppress"; reason: string }
  | { action: "expire"; reason: string };

/** Notifications delivered later than this are dropped instead of arriving stale. */
export const MAX_LATENESS_MINUTES = 20;

export function inQuietHours(at: Date, s: Pick<SendState, "quietHoursEnabled" | "quietStart" | "quietEnd" | "timezone">): boolean {
  if (!s.quietHoursEnabled || s.quietStart === s.quietEnd) return false;
  const t = minutesOf(localTimeOf(at, s.timezone));
  const start = minutesOf(s.quietStart);
  const end = minutesOf(s.quietEnd);
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** Re-checks a queued notification right before delivery. Never affects scores. */
export function decideSend(kind: NotificationKind, scheduledFor: Date, s: SendState): SendDecision {
  if (kind === "test") return { action: "send" };
  const isSummary = kind === "weekly_summary" || kind === "monthly_summary";
  if (!isSummary && s.dayFinal) return { action: "cancel", reason: "day_finalized" };
  if (s.itemScheduled === false) return { action: "cancel", reason: "item_not_scheduled" };
  if (s.itemRulesEnabled === false) return { action: "cancel", reason: "item_notifications_off" };
  if (s.response === "yes") return { action: "cancel", reason: "already_yes" };
  if (s.response === "no") {
    const reconsiderKinds: NotificationKind[] = ["nudge", "deadline", "snooze"];
    if (!(s.reconsiderAfterNo && reconsiderKinds.includes(kind))) return { action: "cancel", reason: "answered_no" };
  }
  if (kind === "evening" && (s.unansweredCount ?? 0) === 0) return { action: "cancel", reason: "nothing_unanswered" };
  if (!s.notificationsEnabled) return { action: "suppress", reason: "notifications_disabled" };
  // Quiet hours apply both to when it was due and to when it would actually arrive.
  if (inQuietHours(scheduledFor, s) || inQuietHours(s.now, s)) return { action: "suppress", reason: "quiet_hours" };
  if (s.now.getTime() - scheduledFor.getTime() > MAX_LATENESS_MINUTES * 60_000) return { action: "expire", reason: "too_late" };
  return { action: "send" };
}

/** Which pending notifications a new answer cancels immediately. */
export function kindsCancelledBy(answer: ResponseValue, reconsiderAfterNo: boolean): NotificationKind[] {
  if (answer === "yes") return ["reminder", "nudge", "deadline", "snooze"];
  if (answer === "no") return reconsiderAfterNo ? ["reminder"] : ["reminder", "nudge", "deadline", "snooze"];
  return [];
}

export const SUMMARY_TIME: LocalTime = "09:00";

/**
 * Weekly summary goes out on the first day of a new week, monthly summary on the 1st,
 * both at 09:00 local time, describing the period that just ended.
 */
export function planSummaries(userId: string, date: LocalDate, settings: GlobalNotificationSettings, isoWeekdayOfDate: number): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const at = zonedInstant(date, SUMMARY_TIME, settings.timezone);
  if (settings.weeklySummaryEnabled && isoWeekdayOfDate === settings.weekStart) {
    out.push({ dedupeKey: key(userId, date, null, "weekly_summary", at), kind: "weekly_summary", itemId: null, localDate: date, scheduledFor: at, title: "Your week", body: "" });
  }
  if (settings.monthlySummaryEnabled && date.endsWith("-01")) {
    out.push({ dedupeKey: key(userId, date, null, "monthly_summary", at), kind: "monthly_summary", itemId: null, localDate: date, scheduledFor: at, title: "Your month", body: "" });
  }
  return out;
}

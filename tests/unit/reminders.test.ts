import { describe, expect, it } from "vitest";
import {
  planDay,
  planSummaries,
  decideSend,
  inQuietHours,
  kindsCancelledBy,
  nudgeOffsetsEvery,
  DEFAULT_ITEM_RULES,
  type GlobalNotificationSettings,
  type PlannableItem,
  type SendState,
} from "@/lib/core/reminders";

const NY = "America/New_York";
const settings: GlobalNotificationSettings = {
  timezone: NY,
  cutoffTime: "23:59",
  notificationsEnabled: true,
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
  eveningReminderEnabled: false,
  eveningReminderTime: "21:00",
  weeklySummaryEnabled: false,
  monthlySummaryEnabled: false,
  weekStart: 1,
};

const exercise: PlannableItem = {
  itemId: "ex",
  name: "Exercise",
  dueTime: null,
  rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["06:00"], nudgeOffsets: [15, 30, 60] },
};

const localTimes = (ns: { scheduledFor: Date }[]) =>
  ns.map((n) => n.scheduledFor.toLocaleTimeString("en-US", { timeZone: NY, hour: "2-digit", minute: "2-digit", hour12: false }));

describe("reminder planning (spec §6)", () => {
  it("Exercise example: 6:00 alert, nudges at 6:15, 6:30 and 7:00", () => {
    const plan = planDay("u1", "2026-10-21", [exercise], settings);
    expect(plan.map((p) => p.kind)).toEqual(["reminder", "nudge", "nudge", "nudge"]);
    expect(localTimes(plan)).toEqual(["06:00", "06:15", "06:30", "07:00"]);
    expect(plan[0].body).toBe("Time to exercise.");
    expect(plan[1].body).toBe("Exercise is still waiting. Have you done it?");
  });

  it("supports zero, one, or several reminders and reminders before a due time", () => {
    expect(planDay("u1", "2026-10-21", [{ ...exercise, rules: { ...DEFAULT_ITEM_RULES } }], settings)).toEqual([]);
    const reading: PlannableItem = {
      itemId: "rd",
      name: "Reading",
      dueTime: "21:00",
      rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["12:00", "18:00"], beforeDueMinutes: [60], deadlineWarningMinutes: 30 },
    };
    const plan = planDay("u1", "2026-10-21", [reading], settings);
    expect(localTimes(plan)).toEqual(["12:00", "18:00", "20:00", "20:30"]);
    expect(plan[3].kind).toBe("deadline");
    expect(plan[3].body).toBe("30 minutes left for your reading goal.");
  });

  it("deadline warnings fall back to the daily cutoff when there is no due time", () => {
    const plan = planDay("u1", "2026-10-21", [{ ...exercise, rules: { ...DEFAULT_ITEM_RULES, deadlineWarningMinutes: 60 } }], settings);
    expect(localTimes(plan)).toEqual(["22:59"]);
  });

  it("supports interval presets and custom intervals", () => {
    expect(nudgeOffsetsEvery(10, 3)).toEqual([10, 20, 30]);
    expect(nudgeOffsetsEvery(45, 2)).toEqual([45, 90]);
    expect(nudgeOffsetsEvery(5, 0)).toEqual([]);
  });

  it("never schedules after the day's cutoff", () => {
    const late: PlannableItem = { ...exercise, rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["23:30"], nudgeOffsets: [15, 30, 60] } };
    expect(localTimes(planDay("u1", "2026-10-21", [late], settings))).toEqual(["23:30", "23:45"]);
  });

  it("is idempotent: re-planning yields identical dedupe keys and no duplicates", () => {
    const a = planDay("u1", "2026-10-21", [exercise], settings).map((p) => p.dedupeKey);
    const b = planDay("u1", "2026-10-21", [exercise, exercise], settings).map((p) => p.dedupeKey);
    expect(new Set(a).size).toBe(a.length);
    expect([...new Set(b)]).toEqual(a);
  });

  it("disabled item rules plan nothing; evening reminder is planned per day", () => {
    const plan = planDay("u1", "2026-10-21", [{ ...exercise, rules: { ...exercise.rules, enabled: false } }], { ...settings, eveningReminderEnabled: true });
    expect(plan.map((p) => p.kind)).toEqual(["evening"]);
    expect(localTimes(plan)).toEqual(["21:00"]);
  });

  it("handles DST: a 02:30 reminder on spring-forward day fires at 03:30", () => {
    const plan = planDay("u1", "2026-03-08", [{ ...exercise, rules: { ...DEFAULT_ITEM_RULES, reminderTimes: ["02:30"] } }], settings);
    expect(plan[0].scheduledFor.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("weekly summary on the week-start day and monthly on the 1st", () => {
    const s = { ...settings, weeklySummaryEnabled: true, monthlySummaryEnabled: true };
    expect(planSummaries("u1", "2026-10-19", s, 1).map((p) => p.kind)).toEqual(["weekly_summary"]);
    expect(planSummaries("u1", "2026-10-20", s, 2)).toEqual([]);
    expect(planSummaries("u1", "2026-11-01", s, 7).map((p) => p.kind)).toEqual(["monthly_summary"]);
  });
});

const base: SendState = {
  now: new Date("2026-10-21T10:15:00Z"),
  notificationsEnabled: true,
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
  timezone: NY,
  dayFinal: false,
  itemScheduled: true,
  itemRulesEnabled: true,
  response: null,
  reconsiderAfterNo: false,
};
const at = new Date("2026-10-21T10:15:00Z");

describe("send-time decisions", () => {
  it("sends a pending nudge for an unanswered item", () => {
    expect(decideSend("nudge", at, base)).toEqual({ action: "send" });
  });

  it("YES cancels every remaining reminder, nudge and deadline warning", () => {
    for (const k of ["reminder", "nudge", "deadline", "snooze"] as const) {
      expect(decideSend(k, at, { ...base, response: "yes" }).action).toBe("cancel");
    }
    expect(kindsCancelledBy("yes", false)).toEqual(["reminder", "nudge", "deadline", "snooze"]);
  });

  it("NO stops routine nudges unless reconsideration reminders are enabled", () => {
    expect(decideSend("nudge", at, { ...base, response: "no" }).action).toBe("cancel");
    expect(decideSend("nudge", at, { ...base, response: "no", reconsiderAfterNo: true }).action).toBe("send");
    expect(decideSend("deadline", at, { ...base, response: "no", reconsiderAfterNo: true }).action).toBe("send");
    expect(decideSend("reminder", at, { ...base, response: "no", reconsiderAfterNo: true }).action).toBe("cancel");
    expect(kindsCancelledBy("no", true)).toEqual(["reminder"]);
  });

  it("never notifies for unscheduled/inactive items or finalized days", () => {
    expect(decideSend("reminder", at, { ...base, itemScheduled: false })).toEqual({ action: "cancel", reason: "item_not_scheduled" });
    expect(decideSend("reminder", at, { ...base, dayFinal: true })).toEqual({ action: "cancel", reason: "day_finalized" });
  });

  it("master switch suppresses everything", () => {
    expect(decideSend("reminder", at, { ...base, notificationsEnabled: false }).action).toBe("suppress");
  });

  it("quiet hours suppress delivery, including across midnight", () => {
    const q = { quietHoursEnabled: true, quietStart: "22:00", quietEnd: "07:00", timezone: NY };
    expect(inQuietHours(new Date("2026-10-22T03:00:00Z"), q)).toBe(true); // 23:00 NY
    expect(inQuietHours(new Date("2026-10-22T10:30:00Z"), q)).toBe(true); // 06:30 NY
    expect(inQuietHours(new Date("2026-10-22T11:00:00Z"), q)).toBe(false); // 07:00 NY
    expect(decideSend("reminder", new Date("2026-10-22T03:00:00Z"), { ...base, ...q, now: new Date("2026-10-22T03:00:00Z") }).action).toBe("suppress");
  });

  it("expired reminders are dropped rather than delivered late", () => {
    const late = new Date(at.getTime() + 21 * 60_000);
    expect(decideSend("reminder", at, { ...base, now: late }).action).toBe("expire");
    expect(decideSend("reminder", at, { ...base, now: new Date(at.getTime() + 19 * 60_000) }).action).toBe("send");
  });

  it("evening reminder only fires when something is unanswered", () => {
    expect(decideSend("evening", at, { ...base, itemScheduled: undefined, unansweredCount: 0 }).action).toBe("cancel");
    expect(decideSend("evening", at, { ...base, itemScheduled: undefined, unansweredCount: 3 }).action).toBe("send");
  });
});

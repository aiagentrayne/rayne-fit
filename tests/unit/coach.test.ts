import { describe, expect, it } from "vitest";
import {
  checkinObservations,
  detectCrisis,
  escalationMessage,
  escalationSteps,
  firstWeekdayOfMonth,
  inWindow,
  nextWeekday,
  nuggetFingerprint,
  nuggetTime,
  outOfQuietHours,
  pickNuggetCategory,
  reviewStatus,
  upcomingInterviews,
  type DayObservation,
} from "@/lib/core/coach";
import { localTimeOf, localDateOf } from "@/lib/core/time";

const NY = "America/New_York";

describe("daily review", () => {
  it("is complete only with all three ratings; missing ratings are not low", () => {
    const r = reviewStatus([{ metric: "energy", rating: 1 }]);
    expect(r).toMatchObject({ energy: 1, mood: null, stress: null, complete: false, missing: ["mood", "stress"] });
    expect(reviewStatus([{ metric: "energy", rating: 3 }, { metric: "mood", rating: 4 }, { metric: "stress", rating: 2 }]).complete).toBe(true);
  });
});

describe("nugget timing", () => {
  it("lands inside the window, is stable for a date, and varies across dates", () => {
    const times = new Set<string>();
    for (let d = 1; d <= 20; d++) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      const at = nuggetTime("user-1", date, "06:00", "09:00", NY);
      expect(at.getTime()).toBe(nuggetTime("user-1", date, "06:00", "09:00", NY).getTime());
      const t = localTimeOf(at, NY);
      expect(t >= "06:00" && t < "09:00").toBe(true);
      expect(localDateOf(at, NY)).toBe(date);
      times.add(t);
    }
    expect(times.size).toBeGreaterThan(5);
  });

  it("moves anything in ROSS quiet hours to when they end", () => {
    const q = { start: "22:00", end: "06:00", timezone: NY };
    const at = new Date("2026-11-10T04:30:00-05:00");
    expect(inWindow(at, q)).toBe(true);
    expect(localTimeOf(outOfQuietHours(at, q), NY)).toBe("06:00");
    const day = new Date("2026-11-10T12:00:00-05:00");
    expect(outOfQuietHours(day, q).getTime()).toBe(day.getTime());
  });
});

describe("interview schedule", () => {
  const prefs = { timezone: NY, weeklyDow: 7, weeklyTime: "18:00", monthlyEnabled: true, quarterlyEnabled: true };

  it("finds the next weekday and the first weekday of a month", () => {
    expect(nextWeekday("2026-11-03", 7)).toBe("2026-11-08");
    expect(nextWeekday("2026-11-08", 7)).toBe("2026-11-08");
    expect(firstWeekdayOfMonth("2026-11-20", 7)).toBe("2026-11-01");
  });

  it("schedules a weekly interview covering the 7 days ending on its due date", () => {
    const [w] = upcomingInterviews("2026-11-10", prefs, null);
    expect(w).toMatchObject({ kind: "weekly", dueDate: "2026-11-15", periodStart: "2026-11-09", periodEnd: "2026-11-15" });
    expect(localTimeOf(w.dueAt, NY)).toBe("18:00");
  });

  it("uses the monthly interview instead of the weekly on the first Sunday of a month", () => {
    expect(upcomingInterviews("2026-11-28", prefs, null)[0]).toMatchObject({ kind: "weekly", dueDate: "2026-11-29" });
    expect(upcomingInterviews("2026-12-01", prefs, null)[0]).toMatchObject({ kind: "monthly", dueDate: "2026-12-06", periodStart: "2026-11-01", periodEnd: "2026-11-30" });
    expect(upcomingInterviews("2026-12-01", { ...prefs, monthlyEnabled: false }, null)[0].kind).toBe("weekly");
  });

  it("offers a quarterly review 90 days after the vision, within a week of it", () => {
    expect(upcomingInterviews("2026-11-10", prefs, "2026-08-14").some((x) => x.kind === "quarterly" && x.dueDate === "2026-11-12")).toBe(true);
    expect(upcomingInterviews("2026-11-10", prefs, "2026-10-01").some((x) => x.kind === "quarterly")).toBe(false);
  });

  it("escalates at due, +24h, +48h, +72h, then daily, with firmer wording", () => {
    const due = new Date("2026-11-08T18:00:00-05:00");
    const steps = escalationSteps(due, new Date("2026-11-13T00:00:00-05:00"));
    expect(steps.map((s) => s.step)).toEqual([0, 1, 2, 3, 4]);
    expect(steps.map((s) => s.kind)).toEqual(["interview_due", "interview_overdue", "interview_overdue", "interview_overdue", "interview_overdue"]);
    expect(steps[1].at.getTime() - due.getTime()).toBe(24 * 3600_000);
    expect(escalationMessage("weekly", 0).title).toMatch(/ready/);
    expect(escalationMessage("weekly", 2).title).toMatch(/2 days overdue/);
    expect(escalationMessage("weekly", 5).body).toMatch(/reschedule|new time/i);
  });
});

describe("nugget mix", () => {
  it("rotates categories and avoids accountability without data", () => {
    expect(pickNuggetCategory(["accountability", "accountability", "educational"], "2026-11-03", true)).toBe("motivational");
    for (let d = 1; d < 15; d++) expect(pickNuggetCategory([], `2026-11-${String(d).padStart(2, "0")}`, false)).not.toBe("accountability");
  });

  it("fingerprints near-duplicate text the same", () => {
    expect(nuggetFingerprint("Show up today!")).toBe(nuggetFingerprint("show up, today."));
  });
});

describe("observations", () => {
  it("needs 5+ days in each group, skips missing ratings, and never claims causation", () => {
    const days: DayObservation[] = [];
    for (let i = 0; i < 6; i++) days.push({ date: `2026-10-0${i + 1}`, pct: 90, ratings: { energy: 5 } });
    for (let i = 0; i < 6; i++) days.push({ date: `2026-10-1${i}`, pct: 50, ratings: { energy: 1 } });
    for (let i = 0; i < 6; i++) days.push({ date: `2026-10-2${i}`, pct: 10, ratings: {} });
    const [o] = checkinObservations(days);
    expect(o).toMatchObject({ metric: "energy", highAvg: 90, lowAvg: 50, highDays: 6, lowDays: 6 });
    expect(o.text).toMatch(/not proof of cause/);
    expect(checkinObservations(days.slice(0, 9))).toHaveLength(0);
  });
});

describe("safety", () => {
  it("flags crisis language and leaves ordinary venting alone", () => {
    expect(detectCrisis("honestly I want to kill myself")).toBe(true);
    expect(detectCrisis("I don't want to be alive anymore")).toBe(true);
    expect(detectCrisis("I've been thinking about suicide")).toBe(true);
    expect(detectCrisis("this workout is killing me")).toBe(false);
    expect(detectCrisis("I'm dying to get back to the gym")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { cutoffInstant, currentDay, isDayOpen } from "@/lib/core/days";
import { zonedInstant, weekStartOf, addDays } from "@/lib/core/time";
import { applicableVersions, isScheduledOn, type ItemVersion } from "@/lib/core/schedule";

const NY = "America/New_York";

describe("daily cutoff, midnight boundary and time zones (spec §7)", () => {
  const clock = { timezone: NY, cutoffTime: "23:59" };

  it("default cutoff is 23:59 local on the same date", () => {
    expect(cutoffInstant("2026-10-21", clock).toISOString()).toBe("2026-10-22T03:59:00.000Z");
  });

  it("an answer at 23:58:59 is in the open day; at 23:59 the day is closed", () => {
    expect(isDayOpen("2026-10-21", new Date("2026-10-22T03:58:59Z"), clock)).toBe(true);
    expect(isDayOpen("2026-10-21", new Date("2026-10-22T03:59:00Z"), clock)).toBe(false);
  });

  it("current day switches at local midnight, not UTC midnight", () => {
    expect(currentDay(new Date("2026-10-22T03:30:00Z"), clock)).toBe("2026-10-21"); // 23:30 NY
    expect(currentDay(new Date("2026-10-22T04:00:00Z"), clock)).toBe("2026-10-22"); // 00:00 NY
  });

  it("late-night cutoffs (before noon) close the day the next morning", () => {
    const owl = { timezone: NY, cutoffTime: "02:00" };
    expect(cutoffInstant("2026-10-21", owl).toISOString()).toBe("2026-10-22T06:00:00.000Z");
    expect(currentDay(new Date("2026-10-22T05:30:00Z"), owl)).toBe("2026-10-21"); // 01:30 NY still Tuesday's scorecard
    expect(currentDay(new Date("2026-10-22T06:00:00Z"), owl)).toBe("2026-10-22");
  });

  it("the same instant is a different scorecard day in different time zones", () => {
    const now = new Date("2026-10-22T02:00:00Z");
    expect(currentDay(now, { timezone: NY, cutoffTime: "23:59" })).toBe("2026-10-21");
    expect(currentDay(now, { timezone: "Asia/Tokyo", cutoffTime: "23:59" })).toBe("2026-10-22");
  });
});

describe("DST policy", () => {
  it("spring-forward: a nonexistent local time moves forward by the gap", () => {
    // 2026-03-08 02:30 does not exist in New York; it resolves to 03:30 EDT.
    expect(zonedInstant("2026-03-08", "02:30", NY).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("fall-back: an ambiguous local time resolves to its first occurrence", () => {
    // 2026-11-01 01:30 happens twice; first is EDT (UTC-4).
    expect(zonedInstant("2026-11-01", "01:30", NY).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("the cutoff stays at 23:59 local on DST change days (23h and 25h days)", () => {
    const clock = { timezone: NY, cutoffTime: "23:59" };
    expect(cutoffInstant("2026-03-08", clock).toISOString()).toBe("2026-03-09T03:59:00.000Z"); // EDT
    expect(cutoffInstant("2026-11-01", clock).toISOString()).toBe("2026-11-02T04:59:00.000Z"); // EST
    expect(cutoffInstant("2026-03-07", clock).toISOString()).toBe("2026-03-08T04:59:00.000Z"); // EST
  });

  it("week boundaries are calendar based and unaffected by DST", () => {
    expect(weekStartOf("2026-11-01", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });
});

const v = (over: Partial<ItemVersion>): ItemVersion => ({
  id: "v1",
  itemId: "i1",
  version: 1,
  name: "Exercise",
  description: null,
  category: null,
  scheduleType: "daily",
  daysOfWeek: [],
  startDate: "2026-01-01",
  endDate: null,
  dueTime: null,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  cadence: "daily",
  targetCount: null,
  milestoneId: null,
  ...over,
});

describe("recurring schedules and scheduled-day exclusions", () => {
  it("weekdays / weekends / custom days", () => {
    // 2026-10-24 is a Saturday
    expect(isScheduledOn(v({ scheduleType: "weekdays" }), "2026-10-24")).toBe(false);
    expect(isScheduledOn(v({ scheduleType: "weekdays" }), "2026-10-23")).toBe(true);
    expect(isScheduledOn(v({ scheduleType: "weekends" }), "2026-10-24")).toBe(true);
    expect(isScheduledOn(v({ scheduleType: "custom", daysOfWeek: [1, 3] }), "2026-10-21")).toBe(true); // Wed
    expect(isScheduledOn(v({ scheduleType: "custom", daysOfWeek: [1, 3] }), "2026-10-22")).toBe(false); // Thu
  });

  it("respects effective start and end dates and inactive status", () => {
    const item = v({ startDate: "2026-10-10", endDate: "2026-10-20" });
    expect(isScheduledOn(item, "2026-10-09")).toBe(false);
    expect(isScheduledOn(item, "2026-10-10")).toBe(true);
    expect(isScheduledOn(item, "2026-10-20")).toBe(true);
    expect(isScheduledOn(item, "2026-10-21")).toBe(false);
    expect(isScheduledOn(v({ isActive: false }), "2026-10-15")).toBe(false);
  });

  it("picks the version in force at the day's cutoff, so later edits never rewrite history", () => {
    const versions = [
      v({ id: "a", version: 1, createdAt: new Date("2026-10-01T00:00:00Z") }),
      v({ id: "b", version: 2, isActive: false, createdAt: new Date("2026-10-15T12:00:00Z") }), // deleted on the 15th
      v({ id: "c", itemId: "i2", version: 1, startDate: "2026-01-01", createdAt: new Date("2026-10-15T12:00:00Z") }), // added on the 15th with a back-dated start
    ];
    const oct10Cutoff = new Date("2026-10-11T03:59:00Z");
    expect(applicableVersions(versions, "2026-10-10", oct10Cutoff).map((x) => x.id)).toEqual(["a"]);
    const oct16Cutoff = new Date("2026-10-17T03:59:00Z");
    expect(applicableVersions(versions, "2026-10-16", oct16Cutoff).map((x) => x.id)).toEqual(["c"]);
  });
});

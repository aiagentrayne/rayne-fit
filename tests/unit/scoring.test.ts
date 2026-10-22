import { describe, expect, it } from "vitest";
import { scoreDay, finalizeResponses, periodGrade, weekGrade, monthGrade, type DaySummary, type ResponseValue } from "@/lib/core/scoring";
import { gradeFor, formatPct, validateThresholds, DEFAULT_GRADE_THRESHOLDS } from "@/lib/core/grading";

const answers = (yes: number, total: number): ResponseValue[] =>
  Array.from({ length: total }, (_, i) => (i < yes ? "yes" : "no"));

describe("binary daily scoring (spec §2, §12)", () => {
  it.each([
    [2, 2, 100, "A+"],
    [1, 2, 50, "F"],
    [4, 5, 80, "B-"],
    [7, 10, 70, "C-"],
    [12, 24, 50, "F"],
    [18, 24, 75, "C"],
    [24, 24, 100, "A+"],
  ])("%i of %i YES = %i%% %s", (yes, total, pct, grade) => {
    const s = scoreDay(answers(yes, total));
    expect(s.pct).toBe(pct);
    expect(s.grade).toBe(grade);
  });

  it("2/3 keeps full precision (66.666…%) and grades D; rounding is display-only", () => {
    const s = scoreDay(answers(2, 3));
    expect(s.pct).toBeCloseTo(66.6666666667, 9);
    expect(s.pct).not.toBe(67);
    expect(s.grade).toBe("D");
    expect(formatPct(s.pct)).toBe("67%");
  });

  it("grades against the unrounded value at boundaries", () => {
    expect(gradeFor(96.99)).toBe("A");
    expect(gradeFor(97)).toBe("A+");
    expect(gradeFor(59.999)).toBe("F");
    expect(gradeFor(60)).toBe("D-");
    // 29/30 = 96.666…% would round to 97% but is an A
    expect(scoreDay(answers(29, 30)).grade).toBe("A");
  });

  it("never displays 100% for an imperfect day", () => {
    expect(formatPct((299 / 300) * 100)).toBe("99%");
    expect(formatPct(100)).toBe("100%");
  });

  it("zero scheduled items is N/A, not 0% or 100%", () => {
    const s = scoreDay([]);
    expect(s.pct).toBeNull();
    expect(s.grade).toBeNull();
    expect(formatPct(s.pct)).toBe("N/A");
  });

  it("pending is not partial credit", () => {
    const s = scoreDay(["yes", null, null, null]);
    expect(s.pct).toBe(25);
    expect(s.pending).toBe(3);
  });

  it("unanswered items finalize as NO at cutoff", () => {
    expect(finalizeResponses(["yes", null, "no", null])).toEqual(["yes", "no", "no", "no"]);
    expect(scoreDay(finalizeResponses(["yes", null])).pct).toBe(50);
  });
});

describe("custom grading thresholds", () => {
  it("accepts the default scale", () => {
    expect(validateThresholds(DEFAULT_GRADE_THRESHOLDS)).toBeNull();
  });
  it("rejects non-descending or non-zero-floored scales", () => {
    expect(validateThresholds([{ grade: "P", min: 50 }, { grade: "F", min: 60 }])).toMatch(/strictly down/);
    expect(validateThresholds([{ grade: "P", min: 50 }, { grade: "F", min: 10 }])).toMatch(/start at 0/);
    expect(validateThresholds([{ grade: "P", min: 50 }, { grade: "P", min: 0 }])).toMatch(/twice/);
  });
  it("applies a custom scale", () => {
    const pf = [{ grade: "P", min: 80 }, { grade: "F", min: 0 }];
    expect(scoreDay(answers(4, 5), pf).grade).toBe("P");
    expect(scoreDay(answers(3, 5), pf).grade).toBe("F");
  });
});

const day = (date: string, yes: number, applicable: number, status: "open" | "final" = "final"): DaySummary => ({ date, yes, applicable, status });

describe("weekly and monthly grades (spec §4)", () => {
  it("weights each day equally regardless of item count", () => {
    // Day 1: 2/2 = 100%. Day 2: 12/24 = 50%. Equal-day mean = 75% (item-weighted would be 53.8%).
    const g = periodGrade([day("2026-10-05", 2, 2), day("2026-10-06", 12, 24)], "2026-10-05", "2026-10-11", "2026-10-20");
    expect(g.pct).toBe(75);
    expect(g.grade).toBe("C");
    expect(g.countedDays).toBe(2);
    expect(g.provisional).toBe(false);
  });

  it("excludes N/A days, open days and future days; marks in-progress periods provisional", () => {
    const days = [day("2026-10-19", 1, 2), day("2026-10-20", 0, 0), day("2026-10-21", 3, 3, "open"), day("2026-10-25", 0, 5)];
    const g = weekGrade(days, "2026-10-21", 1);
    expect(g.start).toBe("2026-10-19");
    expect(g.end).toBe("2026-10-25");
    expect(g.pct).toBe(50);
    expect(g.countedDays).toBe(1);
    expect(g.provisional).toBe(true);
  });

  it("shows N/A when nothing is finalized yet", () => {
    const g = weekGrade([day("2026-10-19", 1, 2, "open")], "2026-10-19", 1);
    expect(g.pct).toBeNull();
    expect(g.grade).toBeNull();
    expect(g.provisional).toBe(true);
  });

  it("supports a configurable week start (Sunday)", () => {
    const g = weekGrade([], "2026-10-21", 7); // Wed 21 Oct 2026
    expect(g.start).toBe("2026-10-18");
    expect(g.end).toBe("2026-10-24");
  });

  it("monthly grade averages finalized days in the calendar month and is final once the month ends", () => {
    const days = [day("2026-09-30", 0, 1), day("2026-10-01", 1, 1), day("2026-10-02", 1, 2), day("2026-11-01", 1, 1)];
    const g = monthGrade(days, "2026-11-05", undefined, "2026-10-15");
    expect(g.start).toBe("2026-10-01");
    expect(g.end).toBe("2026-10-31");
    expect(g.pct).toBe(75);
    expect(g.provisional).toBe(false);
  });

  it("recomputes after a historical correction", () => {
    const before = [day("2026-10-05", 1, 2), day("2026-10-06", 2, 2)];
    const after = [day("2026-10-05", 2, 2), day("2026-10-06", 2, 2)];
    expect(periodGrade(before, "2026-10-05", "2026-10-11", "2026-10-20").pct).toBe(75);
    expect(periodGrade(after, "2026-10-05", "2026-10-11", "2026-10-20").pct).toBe(100);
  });

  it("a period with unfinalized past days stays provisional", () => {
    const g = periodGrade([day("2026-10-05", 1, 2), day("2026-10-06", 0, 2, "open")], "2026-10-05", "2026-10-11", "2026-10-20");
    expect(g.provisional).toBe(true);
  });
});

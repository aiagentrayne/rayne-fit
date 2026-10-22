import { describe, expect, it } from "vitest";
import { perfectStreaks, overallAverage, itemCompletionRates, frequentlyMissed, weeklyTrend, type DayDetail } from "@/lib/core/analytics";
import { resolveResponse, type ExistingResponse, type IncomingResponse } from "@/lib/core/sync";
import type { DaySummary } from "@/lib/core/scoring";

const d = (date: string, yes: number, applicable: number, status: "open" | "final" = "final"): DaySummary => ({ date, yes, applicable, status });

describe("streaks and analytics (spec §8)", () => {
  it("N/A days neither break nor extend perfect streaks", () => {
    const s = perfectStreaks([d("2026-10-01", 2, 2), d("2026-10-02", 0, 0), d("2026-10-03", 3, 3), d("2026-10-04", 1, 2), d("2026-10-05", 1, 1)]);
    expect(s).toEqual({ current: 1, longest: 2, perfectDays: 3 });
  });

  it("open days don't count toward streaks or the overall average", () => {
    const days = [d("2026-10-01", 1, 1), d("2026-10-02", 0, 1, "open")];
    expect(perfectStreaks(days).current).toBe(1);
    expect(overallAverage(days)).toBe(100);
    expect(overallAverage([d("2026-10-01", 1, 2), d("2026-10-02", 0, 0)])).toBe(50);
  });

  it("per-item completion over its last N applicable days, and frequently missed", () => {
    const days: DayDetail[] = Array.from({ length: 10 }, (_, i) => ({
      ...d(`2026-10-${String(i + 1).padStart(2, "0")}`, 0, 2),
      items: [
        { itemId: "a", name: "Exercise", response: i >= 5 ? "yes" : "no" },
        { itemId: "b", name: "Read", response: "yes" },
      ],
    }));
    const rates = itemCompletionRates(days);
    const ex = rates.find((r) => r.itemId === "a")!;
    expect(ex.rates[7]).toEqual({ pct: (5 / 7) * 100, days: 7 });
    expect(ex.rates[30]).toEqual({ pct: 50, days: 10 });
    expect(frequentlyMissed(rates).map((r) => r.name)).toEqual(["Exercise"]);
  });

  it("weekly trend returns consecutive weeks, oldest first", () => {
    const t = weeklyTrend([d("2026-10-13", 1, 1), d("2026-10-20", 1, 2)], "2026-10-21", 1, 3);
    expect(t.map((w) => w.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(t.map((w) => w.pct)).toEqual([null, 100, 50]);
  });
});

const cutoff = new Date("2026-10-22T03:59:00Z");
const inc = (over: Partial<IncomingResponse>): IncomingResponse => ({
  value: "yes",
  clientTime: new Date("2026-10-21T20:00:00Z"),
  receivedAt: new Date("2026-10-21T20:00:01Z"),
  source: "app",
  isCorrection: false,
  ...over,
});
const none: ExistingResponse = { value: null, respondedAt: null, autoFinalized: false };

describe("offline sync conflict resolution (spec §9)", () => {
  it("applies a fresh answer on an open day; repeating it is a no-op", () => {
    expect(resolveResponse(none, inc({}), { status: "open", cutoffAt: cutoff }).outcome).toBe("apply");
    const existing = { value: "yes" as const, respondedAt: new Date("2026-10-21T20:00:00Z"), autoFinalized: false };
    expect(resolveResponse(existing, inc({}), { status: "open", cutoffAt: cutoff }).outcome).toBe("noop");
  });

  it("an older offline tap does not overwrite a newer answer", () => {
    const existing = { value: "no" as const, respondedAt: new Date("2026-10-21T21:00:00Z"), autoFinalized: false };
    const r = resolveResponse(existing, inc({ source: "offline", clientTime: new Date("2026-10-21T20:00:00Z"), receivedAt: new Date("2026-10-21T22:00:00Z") }), { status: "open", cutoffAt: cutoff });
    expect(r).toEqual({ outcome: "stale", reason: "newer_answer_on_server" });
  });

  it("an offline YES tapped before cutoff replaces the automatic NO after finalization (audited)", () => {
    const autoNo = { value: "no" as const, respondedAt: cutoff, autoFinalized: true };
    const r = resolveResponse(autoNo, inc({ source: "offline", clientTime: new Date("2026-10-22T03:00:00Z"), receivedAt: new Date("2026-10-22T12:00:00Z") }), { status: "final", cutoffAt: cutoff });
    expect(r).toMatchObject({ outcome: "apply", audit: "late_offline_sync" });
  });

  it("rejects offline answers tapped after cutoff or synced after the grace window", () => {
    const autoNo = { value: "no" as const, respondedAt: cutoff, autoFinalized: true };
    const afterCutoff = inc({ source: "offline", clientTime: new Date("2026-10-22T04:30:00Z"), receivedAt: new Date("2026-10-22T05:00:00Z") });
    expect(resolveResponse(autoNo, afterCutoff, { status: "final", cutoffAt: cutoff }).outcome).toBe("reject");
    const tooLate = inc({ source: "offline", clientTime: new Date("2026-10-22T03:00:00Z"), receivedAt: new Date("2026-10-26T03:00:00Z") });
    expect(resolveResponse(autoNo, tooLate, { status: "final", cutoffAt: cutoff }).outcome).toBe("reject");
  });

  it("finalized days change only through explicit, audited corrections", () => {
    const final = { value: "no" as const, respondedAt: cutoff, autoFinalized: true };
    expect(resolveResponse(final, inc({ receivedAt: new Date("2026-10-23T00:00:00Z") }), { status: "final", cutoffAt: cutoff }).outcome).toBe("reject");
    expect(resolveResponse(final, inc({ isCorrection: true, receivedAt: new Date("2026-10-23T00:00:00Z") }), { status: "final", cutoffAt: cutoff })).toMatchObject({ outcome: "apply", audit: "correction" });
    expect(resolveResponse(final, inc({ value: null, isCorrection: true }), { status: "final", cutoffAt: cutoff }).outcome).toBe("reject");
  });

  it("clamps device clocks that run ahead of the server", () => {
    const existing = { value: "no" as const, respondedAt: new Date("2026-10-21T20:30:00Z"), autoFinalized: false };
    const r = resolveResponse(existing, inc({ clientTime: new Date("2026-10-23T00:00:00Z"), receivedAt: new Date("2026-10-21T20:00:00Z") }), { status: "open", cutoffAt: cutoff });
    expect(r).toEqual({ outcome: "stale", reason: "newer_answer_on_server" });
  });
});

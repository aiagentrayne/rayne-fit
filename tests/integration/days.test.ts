import { expect, it } from "vitest";
import { describeDb, sql, makeUser, addItem, ny, mid, item } from "./helpers";
import { getToday, getDay, finalizeDueForUser } from "@/server/days";
import { writeResponse, listCorrections } from "@/server/responses";
import { updateItem, setItemStatus } from "@/server/items";
import { updateSettings } from "@/server/settings";
import { getDashboard, getHistory } from "@/server/summary";

const answer = (userId: string, date: string, itemId: string, value: "yes" | "no" | null, at: Date, source: "app" | "offline" = "app", clientTime = at) =>
  writeResponse(sql, userId, { mutationId: mid(), date, itemId, value, clientTime, source, isCorrection: false }, at);

describeDb("daily snapshots and finalization", () => {
  it("1/2 YES = 50% F; unanswered finalizes as NO at the cutoff", async () => {
    const u = await makeUser();
    const a = await addItem(u, "Exercise");
    const b = await addItem(u, "Read");
    const r = await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"));
    expect(r.outcome).toBe("apply");
    expect(r.day).toMatchObject({ status: "open", applicable: 2, yes: 1, scorePct: 50 });

    await finalizeDueForUser(sql, u, ny("2026-10-19", "23:58"));
    expect((await getDay(sql, u, "2026-10-19"))!.day.status).toBe("open");

    await finalizeDueForUser(sql, u, ny("2026-10-19", "23:59"));
    const { day, items } = (await getDay(sql, u, "2026-10-19"))!;
    expect(day).toMatchObject({ status: "final", applicable: 2, yes: 1, scorePct: 50, grade: "F" });
    expect(items.find((i) => i.itemId === b)).toMatchObject({ response: "no", autoFinalized: true, source: "auto" });
  });

  it("2/3 stores full precision and grades D", async () => {
    const u = await makeUser();
    const ids = [await addItem(u, "A"), await addItem(u, "B"), await addItem(u, "C")];
    await answer(u, "2026-10-19", ids[0], "yes", ny("2026-10-19", "10:00"));
    await answer(u, "2026-10-19", ids[1], "yes", ny("2026-10-19", "10:00"));
    await finalizeDueForUser(sql, u, ny("2026-10-20", "08:00"));
    const { day } = (await getDay(sql, u, "2026-10-19"))!;
    expect(day.scorePct).toBeCloseTo(66.66666666666667, 12);
    expect(day.grade).toBe("D");
  });

  it("a day with nothing scheduled is N/A and excluded from averages", async () => {
    const u = await makeUser();
    await addItem(u, "Weekday thing", { scheduleType: "weekdays" });
    // 2026-10-24/25 is a weekend
    await finalizeDueForUser(sql, u, ny("2026-10-26", "08:00"));
    const sat = (await getDay(sql, u, "2026-10-24"))!.day;
    expect(sat).toMatchObject({ status: "final", applicable: 0, scorePct: null, grade: null });
  });

  it("back-fills days the user never opened (all NO) without touching days before the start date", async () => {
    const u = await makeUser("2026-10-19");
    await addItem(u, "Exercise");
    const done = await finalizeDueForUser(sql, u, ny("2026-10-22", "12:00"));
    expect(done).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect((await getDay(sql, u, "2026-10-18"))).toBeNull();
    expect((await getDay(sql, u, "2026-10-21"))!.day).toMatchObject({ yes: 0, applicable: 1, scorePct: 0 });
    // Running again is a no-op (idempotent job)
    expect(await finalizeDueForUser(sql, u, ny("2026-10-22", "12:05"))).toEqual([]);
  });

  it("adding, editing, deactivating or deleting items never rewrites finalized days", async () => {
    const u = await makeUser();
    const a = await addItem(u, "Exercise");
    const b = await addItem(u, "Read");
    await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"));
    await finalizeDueForUser(sql, u, ny("2026-10-20", "07:00"));
    const before = (await getDay(sql, u, "2026-10-19"))!;

    // On the 20th: rename A, delete B, add C with a back-dated start date
    await updateItem(sql, u, a, item("Morning run"), ny("2026-10-20", "08:00"));
    await setItemStatus(sql, u, b, "deleted", ny("2026-10-20", "08:01"));
    const c = await addItem(u, "Meditate", { startDate: "2026-01-01" }, ny("2026-10-20", "08:02"));

    const after = (await getDay(sql, u, "2026-10-19"))!;
    expect(after.day).toEqual(before.day);
    expect(after.items.map((i) => i.name).sort()).toEqual(["Exercise", "Read"]);

    const today = await getToday(sql, u, ny("2026-10-20", "09:00"));
    expect(today.items.map((i) => i.name).sort()).toEqual(["Meditate", "Morning run"]);
    expect(today.items.some((i) => i.itemId === c)).toBe(true);
  });

  it("items deactivated while a day is open drop out of that day", async () => {
    const u = await makeUser();
    const a = await addItem(u, "A");
    await addItem(u, "B");
    await getToday(sql, u, ny("2026-10-19", "09:00"));
    await setItemStatus(sql, u, a, "inactive", ny("2026-10-19", "10:00"));
    const t = await getToday(sql, u, ny("2026-10-19", "10:01"));
    expect(t.items.map((i) => i.name)).toEqual(["B"]);
    expect(t.day.applicable).toBe(1);
  });

  it("different item counts per day keep equal-day weighting in the week grade", async () => {
    const u = await makeUser("2026-10-19");
    const a = await addItem(u, "A");
    const b = await addItem(u, "B");
    // Mon 19th: only A and B (2/2 = 100%)
    await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"));
    await answer(u, "2026-10-19", b, "yes", ny("2026-10-19", "09:00"));
    // Tue 20th: add 22 more items (24 total), answer 12 yes (50%)
    const more: string[] = [];
    for (let i = 0; i < 22; i++) more.push(await addItem(u, `Item ${i}`, {}, ny("2026-10-20", "06:00")));
    const all = [a, b, ...more];
    for (const id of all.slice(0, 12)) await answer(u, "2026-10-20", id, "yes", ny("2026-10-20", "09:00"));
    const dash = await getDashboard(sql, u, ny("2026-10-21", "09:00"));
    expect(dash.week.countedDays).toBe(2);
    expect(dash.week.pct).toBe(75); // (100 + 50) / 2, not 14/26
    expect(dash.week.provisional).toBe(true);
    expect(dash.today.applicable).toBe(24);
  });
});

describeDb("check-ins, idempotency, offline sync and corrections", () => {
  it("retries with the same mutation id are applied once", async () => {
    const u = await makeUser();
    const a = await addItem(u, "A");
    const args = { mutationId: mid(), date: "2026-10-19", itemId: a, value: "yes" as const, clientTime: ny("2026-10-19", "09:00"), source: "app" as const, isCorrection: false };
    expect((await writeResponse(sql, u, args, ny("2026-10-19", "09:00"))).outcome).toBe("apply");
    expect((await writeResponse(sql, u, args, ny("2026-10-19", "09:01"))).outcome).toBe("duplicate");
    const [{ n }] = await sql`select count(*)::int n from response_events where user_id = ${u}`;
    expect(n).toBe(1);
  });

  it("answers can be changed or cleared before the cutoff, but not after", async () => {
    const u = await makeUser();
    const a = await addItem(u, "A");
    await answer(u, "2026-10-19", a, "no", ny("2026-10-19", "09:00"));
    expect((await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "10:00"))).day!.yes).toBe(1);
    expect((await answer(u, "2026-10-19", a, null, ny("2026-10-19", "11:00"))).value).toBeNull();
    const late = await answer(u, "2026-10-19", a, "yes", ny("2026-10-20", "00:30"));
    expect(late.outcome).toBe("reject");
    expect((await getDay(sql, u, "2026-10-19"))!.day.yes).toBe(0);
  });

  it("rejects future dates and unscheduled items", async () => {
    const u = await makeUser();
    const a = await addItem(u, "Weekend", { scheduleType: "weekends" });
    expect((await answer(u, "2026-10-21", a, "yes", ny("2026-10-19", "09:00"))).outcome).toBe("future");
    expect((await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"))).outcome).toBe("not_found");
  });

  it("an offline YES tapped before cutoff and synced next morning replaces the auto NO, with an audit entry", async () => {
    const u = await makeUser();
    const a = await addItem(u, "A");
    await finalizeDueForUser(sql, u, ny("2026-10-20", "07:00"));
    const r = await answer(u, "2026-10-19", a, "yes", ny("2026-10-20", "07:05"), "offline", ny("2026-10-19", "22:00"));
    expect(r.outcome).toBe("apply");
    expect(r.day).toMatchObject({ status: "final", scorePct: 100, grade: "A+" });
    const audit = await listCorrections(sql, u, "2026-10-19");
    expect(audit[0]).toMatchObject({ kind: "late_offline_sync", oldValue: "no", newValue: "yes", oldScorePct: 0, newScorePct: 100 });
  });

  it("an older offline tap loses to a newer online answer (explicit conflict resolution)", async () => {
    const u = await makeUser();
    const a = await addItem(u, "A");
    await answer(u, "2026-10-19", a, "no", ny("2026-10-19", "12:00"));
    const r = await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "13:00"), "offline", ny("2026-10-19", "11:00"));
    expect(r).toMatchObject({ outcome: "stale", value: "no" });
  });

  it("historical corrections are audited and recompute week and month grades", async () => {
    const u = await makeUser("2026-10-19");
    const a = await addItem(u, "A");
    const b = await addItem(u, "B");
    await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"));
    await finalizeDueForUser(sql, u, ny("2026-10-20", "09:00"));
    let dash = await getDashboard(sql, u, ny("2026-10-20", "09:00"));
    expect(dash.week.pct).toBe(50);

    const r = await writeResponse(sql, u, { mutationId: mid(), date: "2026-10-19", itemId: b, value: "yes", clientTime: ny("2026-10-20", "09:05"), source: "app", isCorrection: true, reason: "Forgot to log it" }, ny("2026-10-20", "09:05"));
    expect(r.outcome).toBe("apply");
    dash = await getDashboard(sql, u, ny("2026-10-20", "09:06"));
    expect(dash.week.pct).toBe(100);
    expect(dash.month.pct).toBe(100);
    const audit = await listCorrections(sql, u);
    expect(audit[0]).toMatchObject({ kind: "correction", oldValue: "no", newValue: "yes", reason: "Forgot to log it", oldScorePct: 50, newScorePct: 100 });
  });

  it("history exposes calendar days, streaks and per-item rates", async () => {
    const u = await makeUser("2026-10-19");
    const a = await addItem(u, "A");
    await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"));
    await answer(u, "2026-10-20", a, "yes", ny("2026-10-20", "09:00"));
    const h = await getHistory(sql, u, ny("2026-10-21", "09:00"));
    expect(h.streaks).toEqual({ current: 2, longest: 2, perfectDays: 2 });
    expect(h.itemRates[0].rates[7]).toEqual({ pct: 100, days: 2 });
    expect(h.days.find((d) => d.date === "2026-10-21")!.status).toBe("open");
  });
});

describeDb("time zone and cutoff changes", () => {
  it("a cutoff change applies to today only when the new cutoff is still ahead", async () => {
    const u = await makeUser();
    await addItem(u, "A");
    await getToday(sql, u, ny("2026-10-19", "20:00"));
    await updateSettings(sql, u, { cutoffTime: "19:00" }, ny("2026-10-19", "20:00"));
    expect((await getDay(sql, u, "2026-10-19"))!.day.cutoffAt.toISOString()).toBe(ny("2026-10-19", "23:59").toISOString());
    await updateSettings(sql, u, { cutoffTime: "01:00" }, ny("2026-10-19", "20:00"));
    expect((await getDay(sql, u, "2026-10-19"))!.day.cutoffAt.toISOString()).toBe(ny("2026-10-20", "01:00").toISOString());
    // Late-night cutoff: at 00:30 on the 20th it is still the 19th's scorecard
    expect((await getToday(sql, u, ny("2026-10-20", "00:30"))).day.date).toBe("2026-10-19");
  });

  it("moving time zones keeps finalized days intact and scores the new local day", async () => {
    const u = await makeUser();
    const a = await addItem(u, "A");
    await answer(u, "2026-10-19", a, "yes", ny("2026-10-19", "09:00"));
    await updateSettings(sql, u, { timezone: "Europe/London" }, ny("2026-10-19", "10:00"));
    // London cutoff for the 19th is 23:59 BST = 18:59 NY
    await finalizeDueForUser(sql, u, ny("2026-10-19", "19:00"));
    expect((await getDay(sql, u, "2026-10-19"))!.day).toMatchObject({ status: "final", timezone: "Europe/London", scorePct: 100 });
    expect((await getToday(sql, u, ny("2026-10-19", "20:00"))).day.date).toBe("2026-10-20");
  });
});

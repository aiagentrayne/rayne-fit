import { beforeEach, expect, it } from "vitest";
import { describeDb, sql, makeUser, addItem, ny, mid, FakeSender, subscribe } from "./helpers";
import { saveCheckin, getCheckinDay, logCompletion, undoCompletion, periodMeasurables, saveJournal } from "@/server/tracking";
import { getSettings, setRossEnabled, updateSettings } from "@/server/settings";
import { getToday } from "@/server/days";
import { getItem } from "@/server/items";
import { fileProposals, decideProposal, listProposals } from "@/server/proposals";
import { saveVision, getVision } from "@/server/vision";
import { ensureScheduledSessions, finishSession, sendMessage, getSession, rescheduleSession } from "@/server/coach/sessions";
import { ensureNugget } from "@/server/coach/nuggets";
import { deleteCoachingData } from "@/server/coach/hub";
import { dispatchDue, planForUser } from "@/server/notifications";
import { CRISIS_MESSAGE } from "@/lib/core/coach";

delete process.env.OPENAI_API_KEY;

beforeEach(async () => {
  if (sql) await sql`delete from notification_queue`;
});

async function queue(userId: string) {
  return sql`select kind, status, status_reason, scheduled_for, session_id, title from notification_queue where user_id = ${userId} order by scheduled_for, kind`;
}

describeDb("check-ins and journal", () => {
  it("keeps the review incomplete until all three ratings exist; missing is not low", async () => {
    const u = await makeUser("2026-10-19");
    await saveCheckin(sql, u, { date: "2026-10-20", metric: "energy", rating: 2 }, ny("2026-10-20", "07:30"));
    let d = await getCheckinDay(sql, u, "2026-10-20", ny("2026-10-20", "08:00"));
    expect(d.review).toMatchObject({ energy: 2, mood: null, stress: null, complete: false });
    await saveCheckin(sql, u, { date: "2026-10-20", metric: "mood", rating: 4 }, ny("2026-10-20", "21:00"));
    await saveCheckin(sql, u, { date: "2026-10-20", metric: "stress", rating: 3 }, ny("2026-10-20", "21:01"));
    d = await getCheckinDay(sql, u, "2026-10-20", ny("2026-10-20", "21:05"));
    expect(d.review.complete).toBe(true);
  });

  it("accepts late entries and edits up to 30 days back with their real time, and never future ones", async () => {
    const u = await makeUser("2026-10-10");
    const at = ny("2026-10-21", "09:15");
    await saveCheckin(sql, u, { date: "2026-10-19", metric: "mood", rating: 3 }, at);
    const [row] = await sql`select late, recorded_at from checkins where user_id = ${u}`;
    expect(row.late).toBe(true);
    expect((row.recorded_at as Date).toISOString()).toBe(at.toISOString());
    await expect(saveCheckin(sql, u, { date: "2026-10-22", metric: "mood", rating: 3 }, at)).rejects.toThrow(/future/);
    await saveCheckin(sql, u, { date: "2026-10-19", metric: "mood", rating: 5 }, ny("2026-10-21", "09:20"));
    const [edited] = await sql`select rating from checkins where user_id = ${u} and local_date = '2026-10-19' and metric = 'mood'`;
    expect(edited.rating).toBe(5);
    await saveCheckin(sql, u, { date: "2026-09-21", metric: "mood", rating: 3 }, at);
    await expect(saveCheckin(sql, u, { date: "2026-09-20", metric: "mood", rating: 3 }, at)).rejects.toThrow(/30 days/);
  });

  it("flags crisis language in notes and journal without storing anything extra", async () => {
    const u = await makeUser("2026-10-19");
    const r = await saveJournal(sql, u, "2026-10-20", "Rough day. Honestly I want to end my life.", ny("2026-10-20", "22:00"));
    expect(r.crisis).toBe(true);
    const [s] = await sql`select count(*)::int as n from safety_events where user_id = ${u} and source = 'journal'`;
    expect(s.n).toBe(1);
  });
});

describeDb("weekly and monthly measurables", () => {
  it("are logged per period and never counted in the daily score", async () => {
    const u = await makeUser("2026-10-19");
    await addItem(u, "Read");
    const gym = await addItem(u, "Gym", { cadence: "weekly", targetCount: 3 });
    const { day, items } = await getToday(sql, u, ny("2026-10-20", "09:00"));
    expect(items.map((i) => i.name)).toEqual(["Read"]);
    expect(day.applicable).toBe(1);

    const m = mid();
    await logCompletion(sql, u, { itemId: gym, date: "2026-10-20", mutationId: m }, ny("2026-10-20", "09:00"));
    await logCompletion(sql, u, { itemId: gym, date: "2026-10-20", mutationId: m }, ny("2026-10-20", "09:00")); // replay
    await logCompletion(sql, u, { itemId: gym, date: "2026-10-21", mutationId: mid() }, ny("2026-10-21", "09:00"));
    const s = await getSettings(sql, u);
    let [p] = await periodMeasurables(sql, u, "2026-10-21", s);
    expect(p).toMatchObject({ name: "Gym", cadence: "weekly", target: 3, count: 2, countToday: 1, met: false, periodStart: "2026-10-19" });
    await undoCompletion(sql, u, gym, "2026-10-21", ny("2026-10-21", "10:00"));
    [p] = await periodMeasurables(sql, u, "2026-10-21", s);
    expect(p.count).toBe(1);
  });
});

describeDb("ROSS proposals", () => {
  it("files only valid proposals and changes nothing until the user approves", async () => {
    const u = await makeUser("2026-10-19");
    const read = await addItem(u, "Read");
    const n = await fileProposals(sql, u, null, [
      { kind: "create_measurable", rationale: "Supports the fitness milestone.", payload_json: JSON.stringify({ name: "Gym", cadence: "weekly", scheduleType: "daily", daysOfWeek: [], targetCount: 4 }) },
      { kind: "edit_measurable", rationale: "Smaller target.", payload_json: JSON.stringify({ itemId: read, name: "Read 10 pages" }) },
      { kind: "archive_measurable", rationale: "x", payload_json: JSON.stringify({ itemId: "00000000-0000-0000-0000-000000000000" }) },
      { kind: "delete_everything", rationale: "x", payload_json: "{}" },
      { kind: "create_measurable", rationale: "x", payload_json: "not json" },
    ]);
    expect(n).toBe(2);
    expect((await getItem(sql, u, read))!.current.name).toBe("Read");
    const [items] = await sql`select count(*)::int as n from items where user_id = ${u}`;
    expect(items.n).toBe(1);

    const pending = await listProposals(sql, u);
    const create = pending.find((p) => p.kind === "create_measurable")!;
    const edit = pending.find((p) => p.kind === "edit_measurable")!;
    expect(create.title).toMatch(/Gym/);
    expect(await decideProposal(sql, u, create.id, true, ny("2026-10-20", "12:00"))).toEqual({ status: "applied" });
    expect(await decideProposal(sql, u, edit.id, false)).toEqual({ status: "rejected" });
    await expect(decideProposal(sql, u, create.id, true)).rejects.toThrow(/already decided/);

    const [v] = await sql`select cadence, target_count, changed_by_proposal from item_versions where user_id = ${u} and name = 'Gym'`;
    expect(v).toMatchObject({ cadence: "weekly", target_count: 4, changed_by_proposal: create.id });
    expect((await getItem(sql, u, read))!.current.name).toBe("Read");
  });

  it("applies an approved edit as a new version, keeping reminder rules", async () => {
    const u = await makeUser("2026-10-19");
    const read = await addItem(u, "Read", { rules: { enabled: true, reminderTimes: ["20:00"], beforeDueMinutes: [], nudgeOffsets: [], deadlineWarningMinutes: null, snoozeMinutes: 10, reconsiderAfterNo: false, customMessage: null } });
    await fileProposals(sql, u, null, [{ kind: "edit_measurable", rationale: "", payload_json: JSON.stringify({ itemId: read, name: "Read 10 pages", scheduleType: "weekdays" }) }]);
    const [p] = await listProposals(sql, u);
    await decideProposal(sql, u, p.id, true, ny("2026-10-20", "12:00"));
    const item = (await getItem(sql, u, read))!;
    expect(item.current).toMatchObject({ name: "Read 10 pages", scheduleType: "weekdays", version: 2 });
    expect(item.rules.reminderTimes).toEqual(["20:00"]);
  });
});

describeDb("ROSS interviews and nuggets", () => {
  async function rossUser() {
    const u = await makeUser("2026-10-19", { eveningReminderEnabled: false });
    await setRossEnabled(sql, u, true, { shareCheckins: true, shareJournal: false }, ny("2026-10-19", "12:00"));
    return u;
  }

  it("schedules the weekly interview and escalates daily until it is finished", async () => {
    const u = await rossUser();
    await updateSettings(sql, u, { nuggetEnabled: false });
    const s = await getSettings(sql, u);
    await ensureScheduledSessions(sql, u, s, ny("2026-10-25", "12:00"));
    await ensureScheduledSessions(sql, u, s, ny("2026-10-25", "12:05")); // idempotent
    const sessions = await sql`select id, kind, period_start, period_end, due_at, status from coaching_sessions where user_id = ${u}`;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: "weekly", period_start: "2026-10-19", period_end: "2026-10-25", status: "scheduled" });

    await planForUser(sql, u, ny("2026-10-25", "12:00"));
    const q = await queue(u);
    expect(q.map((r) => r.kind)).toEqual(["interview_due"]);
    expect((q[0].scheduled_for as Date).toISOString()).toBe(ny("2026-10-25", "18:00").toISOString());

    await planForUser(sql, u, ny("2026-10-26", "09:00"));
    const later = (await queue(u)).filter((r) => r.status === "pending" && (r.scheduled_for as Date) > ny("2026-10-26", "00:00"));
    expect(later.map((r) => `${r.kind}:${r.title}`)).toEqual(["interview_overdue:Weekly interview: 1 day overdue"]);

    await finishSession(sql, u, sessions[0].id as string, [], ny("2026-10-26", "10:00"));
    expect((await queue(u)).filter((r) => r.status === "pending")).toHaveLength(0);
    const sender = new FakeSender();
    await subscribe(u);
    await dispatchDue(sql, sender, ny("2026-10-26", "18:00"));
    expect(sender.sent).toHaveLength(0);
  });

  it("restarts reminders from a rescheduled time and marks old interviews missed once a newer one is due", async () => {
    const u = await rossUser();
    await updateSettings(sql, u, { nuggetEnabled: false });
    const s = await getSettings(sql, u);
    await ensureScheduledSessions(sql, u, s, ny("2026-10-25", "12:00"));
    const [x] = await sql`select id from coaching_sessions where user_id = ${u}`;
    await rescheduleSession(sql, u, x.id as string, ny("2026-10-27", "07:30"), ny("2026-10-25", "12:00"));
    await planForUser(sql, u, ny("2026-10-25", "12:01"));
    expect((await queue(u)).filter((r) => r.status === "pending")).toHaveLength(0);
    await ensureScheduledSessions(sql, u, s, new Date("2026-11-02T01:00:00Z"));
    const rows = await sql`select kind, status from coaching_sessions where user_id = ${u} order by due_at`;
    expect(rows.map((r) => `${r.kind}:${r.status}`)).toEqual(["weekly:missed", "monthly:scheduled"]);
  });

  it("answers crisis language with care and resources, without calling the AI", async () => {
    const u = await rossUser();
    const [x] = await sql`insert into coaching_sessions (user_id, kind) values (${u}, 'vision') returning id`;
    const v = await sendMessage(sql, u, x.id as string, "I don't want to be alive anymore", false, ny("2026-10-20", "20:00"));
    expect(v.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(v.messages[1].content).toBe(CRISIS_MESSAGE);
    expect(v.session.safetyPaused).toBe(true);
    const [c] = await sql`select count(*)::int as n from ai_calls where user_id = ${u}`;
    expect(c.n).toBe(0);
  });

  it("refuses to reply when OpenAI isn't configured, keeping the user's message", async () => {
    const u = await rossUser();
    const [x] = await sql`insert into coaching_sessions (user_id, kind) values (${u}, 'vision') returning id`;
    await expect(sendMessage(sql, u, x.id as string, "I want to be fitter", false, ny("2026-10-20", "20:00"))).rejects.toThrow(/OpenAI/);
    const v = await getSession(sql, u, x.id as string);
    expect(v.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("saves one template nugget a day when AI is unavailable, timed inside the window", async () => {
    const u = await rossUser();
    await addItem(u, "Read");
    const early = await ensureNugget(sql, u, ny("2026-10-20", "03:00"));
    expect(early.nugget).toBeNull();
    const r = await ensureNugget(sql, u, ny("2026-10-20", "09:30"), { force: true });
    expect(r.nugget).toMatchObject({ date: "2026-10-20", fallback: true });
    expect(r.nugget!.body.length).toBeGreaterThan(20);
    const t = new Date(r.nugget!.scheduledFor).getTime();
    expect(t).toBeGreaterThanOrEqual(ny("2026-10-20", "06:00").getTime());
    expect(t).toBeLessThan(ny("2026-10-20", "09:00").getTime());
    const again = await ensureNugget(sql, u, ny("2026-10-20", "10:00"), { force: true });
    expect(again.nugget!.id).toBe(r.nugget!.id);
  });

  it("deletes all coaching data on request and turns ROSS off", async () => {
    const u = await rossUser();
    await saveVision(sql, u, { identity: "A strong, steady father", statement: "Healthy and present." });
    await deleteCoachingData(sql, u);
    expect(await getVision(sql, u)).toBeNull();
    expect((await getSettings(sql, u)).rossEnabled).toBe(false);
  });
});

describeDb("check-in reminders", () => {
  it("plans a morning reminder that is cancelled once energy is logged, and folds mood and stress into the evening reminder", async () => {
    const u = await makeUser("2026-10-19", { checkinRemindersEnabled: true, eveningReminderEnabled: true });
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    expect((await queue(u)).map((r) => r.kind)).toEqual(["checkin_morning", "checkin_morning", "evening"]);
    const sender = new FakeSender();
    await dispatchDue(sql, sender, ny("2026-10-20", "07:15"));
    expect(sender.sent.map((s) => s.payload.url)).toEqual(["/checkin"]);
    await saveCheckin(sql, u, { date: "2026-10-20", metric: "energy", rating: 4 }, ny("2026-10-20", "07:20"));
    await dispatchDue(sql, sender, ny("2026-10-20", "10:00"));
    expect(sender.sent).toHaveLength(1);
    await dispatchDue(sql, sender, ny("2026-10-20", "21:00"));
    expect(sender.sent).toHaveLength(2);
    expect(String(sender.sent[1].payload.body)).toMatch(/mood and stress/);
  });
});

import { beforeEach, expect, it } from "vitest";
import { describeDb, sql, makeUser, addItem, ny, mid, FakeSender, subscribe } from "./helpers";
import { planForUser, dispatchDue, handleNotificationAction, sendTestNotification } from "@/server/notifications";
import { writeResponse } from "@/server/responses";
import { updateSettings } from "@/server/settings";
import { setItemStatus } from "@/server/items";
import { makeActionToken } from "@/server/tokens";
import { DEFAULT_ITEM_RULES } from "@/lib/core/reminders";

const exerciseRules = { ...DEFAULT_ITEM_RULES, reminderTimes: ["06:00"], nudgeOffsets: [15, 30, 60] };

async function queue(userId: string) {
  return sql`select id, kind, status, status_reason, scheduled_for, attempts from notification_queue where user_id = ${userId} order by scheduled_for, kind`;
}

// The dispatcher is global (all users), so start each test with an empty queue.
beforeEach(async () => {
  if (sql) await sql`delete from notification_queue`;
});

async function setup(patch = {}) {
  const u = await makeUser("2026-10-19", { eveningReminderEnabled: false, ...patch });
  const ex = await addItem(u, "Exercise", { rules: exerciseRules });
  return { u, ex };
}

describeDb("reminder scheduling", () => {
  it("plans the Exercise example idempotently: re-planning creates no duplicates", async () => {
    const { u } = await setup();
    await planForUser(sql, u, ny("2026-10-20", "00:05"));
    await planForUser(sql, u, ny("2026-10-20", "00:10"));
    await planForUser(sql, u, ny("2026-10-20", "00:15"));
    const q = await queue(u);
    expect(q.map((r) => r.kind)).toEqual(["reminder", "nudge", "nudge", "nudge"]);
    expect(q.map((r) => (r.scheduled_for as Date).toISOString())).toEqual(
      [ny("2026-10-20", "06:00"), ny("2026-10-20", "06:15"), ny("2026-10-20", "06:30"), ny("2026-10-20", "07:00")].map((d) => d.toISOString()),
    );
  });

  it("marking YES cancels all remaining nudges for that item and day immediately", async () => {
    const { u, ex } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    expect(sender.sent).toHaveLength(1);
    await writeResponse(sql, u, { mutationId: mid(), date: "2026-10-20", itemId: ex, value: "yes", clientTime: ny("2026-10-20", "06:10"), source: "app", isCorrection: false }, ny("2026-10-20", "06:10"));
    const q = await queue(u);
    expect(q.map((r) => `${r.kind}:${r.status}`)).toEqual(["reminder:sent", "nudge:cancelled", "nudge:cancelled", "nudge:cancelled"]);
    await planForUser(sql, u, ny("2026-10-20", "06:12")); // re-planning doesn't revive them
    await dispatchDue(sql, sender, ny("2026-10-20", "07:00"));
    expect(sender.sent).toHaveLength(1);
  });

  it("marking NO stops routine nudges; with reconsideration enabled the nudges continue", async () => {
    const { u, ex } = await setup();
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await writeResponse(sql, u, { mutationId: mid(), date: "2026-10-20", itemId: ex, value: "no", clientTime: ny("2026-10-20", "05:30"), source: "app", isCorrection: false }, ny("2026-10-20", "05:30"));
    expect((await queue(u)).every((r) => r.status === "cancelled")).toBe(true);

    const u2 = await makeUser("2026-10-19", { eveningReminderEnabled: false });
    const ex2 = await addItem(u2, "Exercise", { rules: { ...exerciseRules, reconsiderAfterNo: true } });
    await planForUser(sql, u2, ny("2026-10-20", "05:00"));
    await writeResponse(sql, u2, { mutationId: mid(), date: "2026-10-20", itemId: ex2, value: "no", clientTime: ny("2026-10-20", "05:30"), source: "app", isCorrection: false }, ny("2026-10-20", "05:30"));
    await planForUser(sql, u2, ny("2026-10-20", "05:35"));
    expect((await queue(u2)).map((r) => `${r.kind}:${r.status}`)).toEqual(["reminder:cancelled", "nudge:pending", "nudge:pending", "nudge:pending"]);
  });

  it("never notifies for unscheduled or inactive items", async () => {
    const u = await makeUser("2026-10-19", { eveningReminderEnabled: false });
    await addItem(u, "Weekend yoga", { scheduleType: "weekends", rules: exerciseRules });
    await planForUser(sql, u, ny("2026-10-20", "05:00")); // Tuesday
    expect(await queue(u)).toHaveLength(0);

    const { u: u2, ex } = await setup();
    const sender = new FakeSender();
    await subscribe(u2);
    await planForUser(sql, u2, ny("2026-10-20", "05:00"));
    await setItemStatus(sql, u2, ex, "inactive", ny("2026-10-20", "05:30"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    expect(sender.sent).toHaveLength(0);
    expect((await queue(u2))[0]).toMatchObject({ status: "cancelled", status_reason: "item_not_scheduled" });
  });

  it("quiet hours and the master switch suppress delivery without affecting scores", async () => {
    const { u } = await setup({ quietHoursEnabled: true, quietStart: "22:00", quietEnd: "06:30" });
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    expect((await queue(u))[0]).toMatchObject({ status: "suppressed", status_reason: "quiet_hours" });
    await dispatchDue(sql, sender, ny("2026-10-20", "06:30"));
    expect(sender.sent).toHaveLength(1); // the 06:30 nudge (06:15 was suppressed)

    await updateSettings(sql, u, { notificationsEnabled: false }, ny("2026-10-20", "06:40"));
    await planForUser(sql, u, ny("2026-10-20", "06:40"));
    await dispatchDue(sql, sender, ny("2026-10-20", "07:00"));
    expect(sender.sent).toHaveLength(1);
  });

  it("evening reminder reports the live unanswered count", async () => {
    const u = await makeUser("2026-10-19", { eveningReminderEnabled: true, eveningReminderTime: "21:00" });
    await addItem(u, "A");
    await addItem(u, "B");
    await addItem(u, "C");
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "08:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "21:00"));
    expect(sender.sent[0].payload.body).toBe("You have 3 unanswered items today.");
  });

  it("finalizing the day cancels anything still queued", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await planForUser(sql, u, ny("2026-10-21", "08:00")); // finalizes the 20th along the way
    const rows = await sql`select status from notification_queue where user_id = ${u} and local_date = '2026-10-20'`;
    expect(rows.every((r) => r.status === "cancelled")).toBe(true);
  });
});

describeDb("push delivery: permission, retries, idempotency", () => {
  it("records a failure (and keeps in-app reminders) when the user has no push subscription", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    expect((await queue(u))[0]).toMatchObject({ status: "failed", status_reason: "no_push_subscription" });
    const [att] = await sql`select * from notification_attempts where user_id = ${u}`;
    expect(att).toMatchObject({ success: false, error: "no_push_subscription" });
  });

  it("retries transient failures with backoff, then succeeds once", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    sender.script = [{ ok: false, statusCode: 503, error: "unavailable" }];
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    expect((await queue(u))[0]).toMatchObject({ status: "pending", attempts: 1 });
    await dispatchDue(sql, sender, new Date(ny("2026-10-20", "06:00").getTime() + 30_000)); // before backoff elapses: nothing
    expect(sender.sent).toHaveLength(0);
    await dispatchDue(sql, sender, new Date(ny("2026-10-20", "06:01").getTime() + 1000));
    expect(sender.sent).toHaveLength(1);
    expect((await queue(u))[0]).toMatchObject({ status: "sent" });
    const atts = await sql`select success, status_code from notification_attempts where user_id = ${u} order by id`;
    expect(atts.map((a) => a.success)).toEqual([false, true]);
  });

  it("gives up after the maximum attempts and drops stale reminders instead of sending late", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:45")); // offline server/device: reminders 45m late
    const q = await queue(u);
    expect(q[0]).toMatchObject({ kind: "reminder", status: "expired" });
    expect(q[1]).toMatchObject({ kind: "nudge", status: "expired" });
    expect(q[2]).toMatchObject({ kind: "nudge", status: "sent" }); // 06:30, 15m late, still useful
  });

  it("disables subscriptions the push service reports as gone (410)", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    const endpoint = await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    sender.script = [{ ok: false, statusCode: 410, error: "gone" }];
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    const [s] = await sql`select disabled_at from push_subscriptions where endpoint = ${endpoint}`;
    expect(s.disabled_at).not.toBeNull();
    expect((await queue(u))[0]).toMatchObject({ status: "failed" });
  });

  it("concurrent dispatchers never send the same notification twice", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    const at = ny("2026-10-20", "07:00");
    await Promise.all([dispatchDue(sql, sender, at), dispatchDue(sql, sender, at), dispatchDue(sql, sender, at)]);
    const sent = sender.sent.map((s) => s.payload.title);
    // 06:00, 06:15 and 06:30 are more than 20 minutes late and expire; 07:00 is sent exactly once.
    expect(sent).toEqual(["Exercise"]);
  });

  it("test notification reports status honestly when push is not configured", async () => {
    const u = await makeUser();
    const notConfigured = new FakeSender();
    notConfigured.configured = false;
    expect(await sendTestNotification(sql, notConfigured, u, ny("2026-10-20", "10:00"))).toEqual({ status: "failed", reason: "push_not_configured" });
  });
});

describeDb("notification actions", () => {
  async function firstSent(u: string) {
    const [n] = await sql`select id from notification_queue where user_id = ${u} and status = 'sent' order by scheduled_for limit 1`;
    return n.id as string;
  }

  it("Mark YES from a notification updates the correct date/item exactly once and cancels nudges", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    const token = sender.sent[0].payload.token as string;
    const r1 = await handleNotificationAction(sql, token, "yes", ny("2026-10-20", "06:05"));
    const r2 = await handleNotificationAction(sql, token, "yes", ny("2026-10-20", "06:06"));
    expect(r1).toMatchObject({ ok: true, duplicate: false });
    expect(r2).toMatchObject({ ok: true, duplicate: true });
    const [di] = await sql`select response, response_source from day_items where user_id = ${u} and local_date = '2026-10-20'`;
    expect(di).toMatchObject({ response: "yes", response_source: "notification" });
    expect((await queue(u)).filter((q) => q.status === "pending")).toHaveLength(0);
  });

  it("rejects forged or tampered tokens", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    const id = await firstSent(u);
    expect(await handleNotificationAction(sql, `${id}.forged`, "yes")).toEqual({ ok: false, error: "invalid_token" });
    expect(await handleNotificationAction(sql, makeActionToken(id).replace(/.$/, "x"), "yes")).toMatchObject({ ok: false });
  });

  it("Snooze schedules exactly one follow-up after the item's snooze duration", async () => {
    const { u } = await setup();
    const sender = new FakeSender();
    await subscribe(u);
    await planForUser(sql, u, ny("2026-10-20", "05:00"));
    await dispatchDue(sql, sender, ny("2026-10-20", "06:00"));
    const token = sender.sent[0].payload.token as string;
    await handleNotificationAction(sql, token, "snooze", ny("2026-10-20", "06:02"));
    await handleNotificationAction(sql, token, "snooze", ny("2026-10-20", "06:03"));
    const snoozes = await sql`select scheduled_for from notification_queue where user_id = ${u} and kind = 'snooze'`;
    expect(snoozes).toHaveLength(1);
    expect((snoozes[0].scheduled_for as Date).toISOString()).toBe(ny("2026-10-20", "06:12").toISOString());
    await dispatchDue(sql, sender, ny("2026-10-20", "06:12"));
    expect(sender.sent.map((s) => s.payload.kind)).toEqual(["reminder", "snooze"]);
  });
});

describeDb("row-level security", () => {
  it("signed-in users can read only their own rows and cannot write directly", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await addItem(a, "A's item");
    await addItem(b, "B's item");
    const rows = await sql.begin(async (t) => {
      await t`select set_config('request.jwt.claim.sub', ${a}, true)`;
      await t`set local role authenticated`;
      return t`select name from item_versions`;
    });
    expect(rows.map((r) => r.name)).toEqual(["A's item"]);
    await expect(
      sql.begin(async (t) => {
        await t`select set_config('request.jwt.claim.sub', ${a}, true)`;
        await t`set local role authenticated`;
        await t`insert into items (user_id) values (${a})`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

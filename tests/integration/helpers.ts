import { randomUUID } from "node:crypto";
import { createSql } from "@/server/db";
import { updateSettings, getSettings, type SettingsPatch } from "@/server/settings";
import { createItem, type ItemInput } from "@/server/items";
import type { PushResult, PushSender, PushTarget } from "@/server/push";

export const TEST_URL = process.env.TEST_DATABASE_URL;
export const sql = TEST_URL ? createSql(TEST_URL, 4) : (null as never);
export const describeDb = TEST_URL ? (await import("vitest")).describe : (await import("vitest")).describe.skip;

process.env.ACTION_TOKEN_SECRET ??= "test-secret-test-secret-test-secret-123";

/** Creates a user whose scorecard starts on `startDate` (New York time, 23:59 cutoff). */
export async function makeUser(startDate = "2026-10-19", patch: SettingsPatch = {}) {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${id + "@test.local"})`;
  await getSettings(sql, id, { timezone: "America/New_York", now: new Date(`${startDate}T16:00:00Z`) });
  if (Object.keys(patch).length) await updateSettings(sql, id, patch, new Date(`${startDate}T16:00:00Z`));
  return id;
}

export function item(name: string, over: Partial<ItemInput> = {}): ItemInput {
  return { name, scheduleType: "daily", daysOfWeek: [], startDate: "2026-01-01", ...over };
}

export async function addItem(userId: string, name: string, over: Partial<ItemInput> = {}, at = new Date("2026-10-19T12:00:00Z")) {
  return createItem(sql, userId, item(name, over), at);
}

/** An instant at a New York wall-clock time (EDT, UTC-4, valid through Nov 1 2026). */
export function ny(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-04:00`);
}

let seq = 0;
export const mid = () => `test-mutation-${++seq}-${randomUUID()}`;

export class FakeSender implements PushSender {
  configured = true;
  sent: { target: PushTarget; payload: Record<string, unknown> }[] = [];
  /** Queue of results to return; defaults to success. */
  script: Partial<PushResult>[] = [];
  async send(target: PushTarget, payload: string): Promise<PushResult> {
    const next = this.script.shift();
    if (next && !next.ok) return { ok: false, ...next };
    this.sent.push({ target, payload: JSON.parse(payload) });
    return { ok: true, statusCode: 201 };
  }
}

export async function subscribe(userId: string, endpoint = `https://push.example/${randomUUID()}`) {
  await sql`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (${userId}, ${endpoint}, 'p', 'a')`;
  return endpoint;
}

import { z } from "zod";
import { tx, type Sql } from "./db";
import type { ItemVersion, ScheduleType } from "@/lib/core/schedule";
import { DEFAULT_ITEM_RULES, type ItemNotificationRules } from "@/lib/core/reminders";
import { isLocalDate, isLocalTime, type LocalDate } from "@/lib/core/time";

export type ItemStatus = "active" | "inactive" | "archived" | "deleted";

export interface Item {
  id: string;
  position: number;
  status: ItemStatus;
  current: ItemVersion;
  rules: ItemNotificationRules;
}

type Row = Record<string, unknown>;

export function mapVersion(r: Row): ItemVersion {
  return {
    id: r.id as string,
    itemId: r.item_id as string,
    version: Number(r.version),
    name: r.name as string,
    description: (r.description as string) ?? null,
    category: (r.category as string) ?? null,
    scheduleType: r.schedule_type as ScheduleType,
    daysOfWeek: ((r.days_of_week as number[]) ?? []).map(Number),
    startDate: r.start_date as LocalDate,
    endDate: (r.end_date as LocalDate) ?? null,
    dueTime: (r.due_time as string) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
  };
}

export function mapRules(r: Row | undefined): ItemNotificationRules {
  if (!r) return { ...DEFAULT_ITEM_RULES };
  return {
    enabled: r.enabled as boolean,
    reminderTimes: (r.reminder_times as string[]) ?? [],
    beforeDueMinutes: ((r.before_due_minutes as number[]) ?? []).map(Number),
    nudgeOffsets: ((r.nudge_offsets as number[]) ?? []).map(Number),
    deadlineWarningMinutes: r.deadline_warning_minutes == null ? null : Number(r.deadline_warning_minutes),
    snoozeMinutes: Number(r.snooze_minutes),
    reconsiderAfterNo: r.reconsider_after_no as boolean,
    customMessage: (r.custom_message as string) ?? null,
  };
}

const minutes = z.number().int().min(1).max(720);

export const rulesSchema = z.object({
  enabled: z.boolean(),
  reminderTimes: z.array(z.string().refine(isLocalTime, "Use HH:MM.")).max(24),
  beforeDueMinutes: z.array(minutes).max(10),
  nudgeOffsets: z.array(minutes).max(24),
  deadlineWarningMinutes: minutes.nullable(),
  snoozeMinutes: z.number().int().min(1).max(240),
  reconsiderAfterNo: z.boolean(),
  customMessage: z.string().trim().max(200).nullable(),
});

export const itemInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    scheduleType: z.enum(["daily", "weekdays", "weekends", "custom"]),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    startDate: z.string().refine(isLocalDate, "Invalid start date."),
    endDate: z.string().refine(isLocalDate, "Invalid end date.").nullable().optional(),
    dueTime: z.string().refine(isLocalTime, "Use HH:MM.").nullable().optional(),
    rules: rulesSchema.optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "End date must be on or after the start date.", path: ["endDate"] })
  .refine((v) => v.scheduleType !== "custom" || v.daysOfWeek.length > 0, { message: "Pick at least one day.", path: ["daysOfWeek"] });

export type ItemInput = z.infer<typeof itemInputSchema>;

export async function loadVersions(sql: Sql, userId: string): Promise<ItemVersion[]> {
  const rows = await sql`select * from item_versions where user_id = ${userId} order by item_id, version`;
  return rows.map(mapVersion);
}

export async function listItems(sql: Sql, userId: string, opts: { includeDeleted?: boolean } = {}): Promise<Item[]> {
  const items = await sql`
    select id, position, status from items
    where user_id = ${userId} ${opts.includeDeleted ? sql`` : sql`and status <> 'deleted'`}
    order by position, created_at`;
  if (!items.length) return [];
  const ids = items.map((i) => i.id as string);
  const versions = await sql`
    select distinct on (item_id) * from item_versions where item_id in ${sql(ids)} order by item_id, version desc`;
  const rules = await sql`select * from item_notification_rules where item_id in ${sql(ids)}`;
  const vById = new Map(versions.map((v) => [v.item_id as string, mapVersion(v)]));
  const rById = new Map(rules.map((r) => [r.item_id as string, r]));
  return items.map((i) => ({
    id: i.id as string,
    position: Number(i.position),
    status: i.status as ItemStatus,
    current: vById.get(i.id as string)!,
    rules: mapRules(rById.get(i.id as string)),
  }));
}

export async function getItem(sql: Sql, userId: string, itemId: string): Promise<Item | null> {
  return (await listItems(sql, userId, { includeDeleted: true })).find((i) => i.id === itemId) ?? null;
}

async function insertVersion(t: Sql, userId: string, itemId: string, version: number, input: ItemInput, isActive: boolean, now: Date) {
  await t`
    insert into item_versions (item_id, user_id, version, name, description, category, schedule_type, days_of_week, start_date, end_date, due_time, is_active, created_at)
    values (${itemId}, ${userId}, ${version}, ${input.name}, ${input.description ?? null}, ${input.category ?? null}, ${input.scheduleType},
            ${input.scheduleType === "custom" ? [...new Set(input.daysOfWeek)].sort() : []}::smallint[], ${input.startDate}, ${input.endDate ?? null},
            ${input.dueTime ?? null}, ${isActive}, ${now})`;
}

async function upsertRules(t: Sql, userId: string, itemId: string, rules: ItemNotificationRules) {
  await t`
    insert into item_notification_rules (item_id, user_id, enabled, reminder_times, before_due_minutes, nudge_offsets,
      deadline_warning_minutes, snooze_minutes, reconsider_after_no, custom_message)
    values (${itemId}, ${userId}, ${rules.enabled}, ${[...new Set(rules.reminderTimes)].sort()}::text[], ${rules.beforeDueMinutes}::int[],
      ${[...new Set(rules.nudgeOffsets)].sort((a, b) => a - b)}::int[], ${rules.deadlineWarningMinutes}, ${rules.snoozeMinutes},
      ${rules.reconsiderAfterNo}, ${rules.customMessage || null})
    on conflict (item_id) do update set enabled = excluded.enabled, reminder_times = excluded.reminder_times,
      before_due_minutes = excluded.before_due_minutes, nudge_offsets = excluded.nudge_offsets,
      deadline_warning_minutes = excluded.deadline_warning_minutes, snooze_minutes = excluded.snooze_minutes,
      reconsider_after_no = excluded.reconsider_after_no, custom_message = excluded.custom_message, updated_at = now()`;
}

export async function createItem(sql: Sql, userId: string, input: ItemInput, now = new Date()): Promise<string> {
  return tx(sql, async (t) => {
    const [{ next }] = await t`select coalesce(max(position), -1) + 1 as next from items where user_id = ${userId}`;
    const [{ id }] = await t`insert into items (user_id, position) values (${userId}, ${next}) returning id`;
    await insertVersion(t, userId, id, 1, input, true, now);
    await upsertRules(t, userId, id, input.rules ?? DEFAULT_ITEM_RULES);
    return id as string;
  });
}

function definitionChanged(v: ItemVersion, input: ItemInput): boolean {
  const days = input.scheduleType === "custom" ? [...new Set(input.daysOfWeek)].sort().join(",") : "";
  return (
    v.name !== input.name ||
    (v.description ?? null) !== (input.description ?? null) ||
    (v.category ?? null) !== (input.category ?? null) ||
    v.scheduleType !== input.scheduleType ||
    (v.scheduleType === "custom" ? v.daysOfWeek.join(",") : "") !== days ||
    v.startDate !== input.startDate ||
    (v.endDate ?? null) !== (input.endDate ?? null) ||
    (v.dueTime ?? null) !== (input.dueTime ?? null)
  );
}

/** Edits never mutate an existing version; they append a new one. */
export async function updateItem(sql: Sql, userId: string, itemId: string, input: ItemInput, now = new Date()): Promise<void> {
  await tx(sql, async (t) => {
    const item = await getItem(t, userId, itemId);
    if (!item || item.status === "deleted") throw new NotFoundError("Item not found.");
    if (definitionChanged(item.current, input)) {
      await insertVersion(t, userId, itemId, item.current.version + 1, input, item.current.isActive, now);
    }
    if (input.rules) await upsertRules(t, userId, itemId, input.rules);
    await t`update items set updated_at = now() where id = ${itemId}`;
  });
}

export async function setItemStatus(sql: Sql, userId: string, itemId: string, status: ItemStatus, now = new Date()): Promise<void> {
  await tx(sql, async (t) => {
    const item = await getItem(t, userId, itemId);
    if (!item || item.status === "deleted") throw new NotFoundError("Item not found.");
    if (item.status === status) return;
    const v = item.current;
    const active = status === "active";
    if (v.isActive !== active) {
      await insertVersion(t, userId, itemId, v.version + 1, { ...v, description: v.description, category: v.category, endDate: v.endDate, dueTime: v.dueTime }, active, now);
    }
    await t`update items set status = ${status}, updated_at = now() where id = ${itemId} and user_id = ${userId}`;
  });
}

export async function reorderItems(sql: Sql, userId: string, orderedIds: string[]): Promise<void> {
  await tx(sql, async (t) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await t`update items set position = ${i}, updated_at = now() where id = ${orderedIds[i]} and user_id = ${userId}`;
    }
  });
}

export class NotFoundError extends Error {}

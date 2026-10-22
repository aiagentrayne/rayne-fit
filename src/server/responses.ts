import { z } from "zod";
import { tx, type Sql } from "./db";
import { getSettings } from "./settings";
import { ensureDay, finalizeDueForUser, getDay, recount, mapDay } from "./days";
import { cancelForAnswer } from "./notifications";
import { currentDay } from "@/lib/core/days";
import { resolveResponse, type Resolution, type ResponseSource } from "@/lib/core/sync";
import { isLocalDate, type LocalDate } from "@/lib/core/time";
import type { ResponseValue } from "@/lib/core/scoring";

export const responseInputSchema = z.object({
  mutationId: z.string().min(8).max(120),
  date: z.string().refine(isLocalDate, "Invalid date."),
  itemId: z.string().uuid(),
  value: z.enum(["yes", "no"]).nullable(),
  clientTime: z.string().datetime({ offset: true }),
  source: z.enum(["app", "offline", "notification"]).default("app"),
});

export const correctionInputSchema = z.object({
  mutationId: z.string().min(8).max(120),
  date: z.string().refine(isLocalDate, "Invalid date."),
  itemId: z.string().uuid(),
  value: z.enum(["yes", "no"]),
  reason: z.string().trim().max(500).nullable().optional(),
});

export interface ResponseResult {
  outcome: Resolution["outcome"] | "duplicate" | "not_found" | "future";
  reason?: string;
  date: LocalDate;
  itemId: string;
  /** The value now stored on the server (authoritative), for the client to reconcile with. */
  value: ResponseValue;
  day: { status: "open" | "final"; applicable: number; yes: number; scorePct: number | null; grade: string | null } | null;
}

interface WriteArgs {
  mutationId: string;
  date: LocalDate;
  itemId: string;
  value: ResponseValue;
  clientTime: Date;
  source: ResponseSource;
  isCorrection: boolean;
  reason?: string | null;
}

/**
 * The single server-authoritative path for every check-in: app taps, offline replays,
 * notification actions and historical corrections. Idempotent per mutationId.
 */
export async function writeResponse(sql: Sql, userId: string, args: WriteArgs, now = new Date()): Promise<ResponseResult> {
  const settings = await getSettings(sql, userId, { now });
  // Close any day whose cutoff passed first, so a late write sees the finalized state.
  await finalizeDueForUser(sql, userId, now);

  const result = await tx(sql, async (t): Promise<ResponseResult> => {
    const base = { date: args.date, itemId: args.itemId };
    const inserted = await t`
      insert into response_events (user_id, mutation_id, local_date, item_id, value, source, client_time, received_at, outcome)
      values (${userId}, ${args.mutationId}, ${args.date}, ${args.itemId}, ${args.value}, ${args.source}, ${args.clientTime}, ${now}, 'pending')
      on conflict (user_id, mutation_id) do nothing returning id`;
    if (!inserted.length) {
      const cur = await getDay(t, userId, args.date);
      const item = cur?.items.find((i) => i.itemId === args.itemId);
      return { ...base, outcome: "duplicate", value: item?.response ?? null, day: cur ? summary(cur.day) : null };
    }
    const eventId = inserted[0].id;
    const setOutcome = (o: string) => t`update response_events set outcome = ${o} where id = ${eventId}`;

    if (args.date > currentDay(now, settings)) {
      await setOutcome("future");
      return { ...base, outcome: "future", value: null, day: null };
    }
    const [existingDay] = await t`select * from day_records where user_id = ${userId} and local_date = ${args.date}`;
    if (!existingDay && args.date < settings.scoringStartDate) {
      await setOutcome("not_found");
      return { ...base, outcome: "not_found", reason: "before_start", value: null, day: null };
    }
    const day = await ensureDay(t, userId, args.date, settings, now);
    const [row] = await t`select * from day_items where user_id = ${userId} and local_date = ${args.date} and item_id = ${args.itemId} for update`;
    if (!row) {
      await setOutcome("not_found");
      return { ...base, outcome: "not_found", reason: "item_not_scheduled", value: null, day: summary(day) };
    }

    const resolution = resolveResponse(
      { value: (row.response as ResponseValue) ?? null, respondedAt: (row.responded_at as Date) ?? null, autoFinalized: row.auto_finalized as boolean },
      { value: args.value, clientTime: args.clientTime, receivedAt: now, source: args.source, isCorrection: args.isCorrection },
      { status: day.status, cutoffAt: day.cutoffAt },
    );
    await setOutcome(resolution.outcome + ("reason" in resolution ? `:${resolution.reason}` : ""));
    if (resolution.outcome !== "apply") {
      return { ...base, outcome: resolution.outcome, reason: "reason" in resolution ? resolution.reason : undefined, value: (row.response as ResponseValue) ?? null, day: summary(day) };
    }

    const source: ResponseSource = resolution.audit === "correction" ? "correction" : args.source;
    await t`update day_items set response = ${args.value}, responded_at = ${resolution.effectiveTime}, response_source = ${source}, auto_finalized = false
            where user_id = ${userId} and local_date = ${args.date} and item_id = ${args.itemId}`;
    await recount(t, userId, args.date, settings);
    const [after] = await t`select * from day_records where user_id = ${userId} and local_date = ${args.date}`;
    const updated = mapDay(after);
    if (resolution.audit) {
      await t`insert into corrections (user_id, local_date, item_id, item_name, old_value, new_value, old_score_pct, new_score_pct, kind, reason)
              values (${userId}, ${args.date}, ${args.itemId}, ${row.name as string}, ${(row.response as string) ?? null}, ${args.value},
                      ${day.scorePct}, ${updated.scorePct}, ${resolution.audit}, ${args.reason ?? null})`;
    }
    if (day.status === "open") await cancelForAnswer(t, userId, args.date, args.itemId, args.value);
    return { ...base, outcome: "apply", value: args.value, day: summary(updated) };
  });
  return result;
}

function summary(d: { status: "open" | "final"; applicable: number; yes: number; scorePct: number | null; grade: string | null }) {
  return { status: d.status, applicable: d.applicable, yes: d.yes, scorePct: d.scorePct, grade: d.grade };
}

export async function listCorrections(sql: Sql, userId: string, date?: LocalDate) {
  const rows = await sql`select * from corrections where user_id = ${userId} ${date ? sql`and local_date = ${date}` : sql``} order by created_at desc limit 200`;
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.local_date as string,
    itemId: r.item_id as string,
    itemName: r.item_name as string,
    oldValue: r.old_value as string | null,
    newValue: r.new_value as string | null,
    oldScorePct: r.old_score_pct as number | null,
    newScorePct: r.new_score_pct as number | null,
    kind: r.kind as string,
    reason: r.reason as string | null,
    createdAt: r.created_at as Date,
  }));
}

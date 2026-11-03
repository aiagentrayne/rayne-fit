/**
 * ROSS's only way to change anything: a proposal. Proposals are validated when filed and again
 * when the user approves, and are applied only on that explicit approval. Applied measurable
 * changes are recorded on the new item version as changed_by_proposal.
 */
import { z } from "zod";
import type { Sql } from "./db";
import { createItem, getItem, itemInputSchema, setItemStatus, updateItem, NotFoundError, type ItemInput } from "./items";
import { createMilestone, saveVision, updateMilestone, milestoneSchema, visionSchema } from "./vision";
import { HttpError } from "./auth";
import { getSettings } from "./settings";
import { currentDay } from "@/lib/core/days";
import { describeCadence } from "@/lib/core/schedule";
import { isLocalDate } from "@/lib/core/time";

const uuid = z.string().uuid();
const cadenceFields = {
  cadence: z.enum(["daily", "weekly", "monthly"]),
  scheduleType: z.enum(["daily", "weekdays", "weekends", "custom"]),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7),
  targetCount: z.number().int().min(1).max(31).nullable(),
};

export const payloadSchemas = {
  create_measurable: z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).nullable().optional(),
      category: z.string().trim().max(60).nullable().optional(),
      ...cadenceFields,
      milestoneId: uuid.nullable().optional(),
    })
    .strict(),
  edit_measurable: z
    .object({
      itemId: uuid,
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      cadence: cadenceFields.cadence.optional(),
      scheduleType: cadenceFields.scheduleType.optional(),
      daysOfWeek: cadenceFields.daysOfWeek.optional(),
      targetCount: cadenceFields.targetCount.optional(),
      dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      milestoneId: uuid.nullable().optional(),
    })
    .strict(),
  archive_measurable: z.object({ itemId: uuid }).strict(),
  create_milestone: z
    .object({
      title: z.string().trim().min(1).max(200),
      detail: z.string().trim().max(1000).nullable().optional(),
      horizon: z.enum(["1y", "5y", "other"]),
      targetDate: z.string().refine(isLocalDate).nullable().optional(),
    })
    .strict(),
  edit_milestone: z
    .object({
      milestoneId: uuid,
      title: z.string().trim().min(1).max(200).optional(),
      detail: z.string().trim().max(1000).nullable().optional(),
      horizon: z.enum(["1y", "5y", "other"]).optional(),
      targetDate: z.string().refine(isLocalDate).nullable().optional(),
      status: z.enum(["active", "achieved", "dropped"]).optional(),
    })
    .strict(),
  update_vision: z
    .object({
      identity: z.string().trim().min(1).max(2000),
      statement: z.string().trim().min(1).max(4000),
      oneYear: z.string().trim().max(2000),
      fiveYear: z.string().trim().max(2000),
    })
    .strict(),
} as const;

export type ProposalKind = keyof typeof payloadSchemas;
export const PROPOSAL_KINDS = Object.keys(payloadSchemas) as ProposalKind[];

export interface Proposal {
  id: string;
  sessionId: string | null;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  rationale: string;
  status: "pending" | "applied" | "rejected" | "failed";
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  title: string;
  details: string[];
}

type Row = Record<string, unknown>;


/** Checks a proposal's payload and that every id it references belongs to the user. */
export async function validateProposal(sql: Sql, userId: string, kind: string, payload: unknown): Promise<{ kind: ProposalKind; payload: Record<string, unknown> }> {
  if (!(kind in payloadSchemas)) throw new HttpError(400, "Unknown proposal kind.");
  const k = kind as ProposalKind;
  const p = payloadSchemas[k].parse(payload) as Record<string, unknown>;
  if ("itemId" in p) {
    const item = await getItem(sql, userId, p.itemId as string);
    if (!item || item.status === "deleted") throw new NotFoundError("That measurable no longer exists.");
  }
  for (const key of ["milestoneId"] as const) {
    if (p[key]) {
      const [m] = await sql`select id from milestones where id = ${p[key] as string} and user_id = ${userId}`;
      if (!m) throw new NotFoundError("That milestone no longer exists.");
    }
  }
  if (k === "create_measurable") itemInputSchema.parse(toItemInput(p));
  return { kind: k, payload: p };
}

function toItemInput(p: Record<string, unknown>, base?: ItemInput, startDate = new Date().toISOString().slice(0, 10)): ItemInput {
  const cadence = (p.cadence ?? base?.cadence ?? "daily") as ItemInput["cadence"];
  return {
    name: (p.name as string) ?? base?.name ?? "",
    description: p.description !== undefined ? (p.description as string | null) : (base?.description ?? null),
    category: p.category !== undefined ? (p.category as string | null) : (base?.category ?? null),
    scheduleType: (p.scheduleType ?? base?.scheduleType ?? "daily") as ItemInput["scheduleType"],
    daysOfWeek: (p.daysOfWeek ?? base?.daysOfWeek ?? []) as number[],
    startDate: base?.startDate ?? startDate,
    endDate: base?.endDate ?? null,
    dueTime: p.dueTime !== undefined ? (p.dueTime as string | null) : (base?.dueTime ?? null),
    cadence,
    targetCount: cadence === "daily" ? null : ((p.targetCount ?? base?.targetCount ?? 1) as number),
    milestoneId: p.milestoneId !== undefined ? (p.milestoneId as string | null) : (base?.milestoneId ?? null),
  };
}

/** Saves ROSS's proposals from a session. Invalid ones are dropped (and logged), never applied. */
export async function fileProposals(sql: Sql, userId: string, sessionId: string | null, raw: { kind: string; rationale: string; payload_json: string }[]): Promise<number> {
  let n = 0;
  for (const r of raw.slice(0, 6)) {
    try {
      const { kind, payload } = await validateProposal(sql, userId, r.kind, JSON.parse(r.payload_json));
      const [dup] = await sql`select id from proposals where user_id = ${userId} and status = 'pending' and kind = ${kind} and payload = ${sql.json(payload as never)}`;
      if (dup) continue;
      await sql`insert into proposals (user_id, session_id, kind, payload, rationale) values (${userId}, ${sessionId}, ${kind}, ${sql.json(payload as never)}, ${r.rationale.slice(0, 1000)})`;
      n++;
    } catch (e) {
      console.warn("[proposal dropped]", r.kind, (e as Error).message);
    }
  }
  return n;
}

async function describe(sql: Sql, userId: string, kind: ProposalKind, p: Record<string, unknown>): Promise<{ title: string; details: string[] }> {
  const cad = (c: Record<string, unknown>) =>
    describeCadence((c.cadence as never) ?? "daily", (c.targetCount as number) ?? null, (c.scheduleType as never) ?? "daily", (c.daysOfWeek as number[]) ?? []);
  switch (kind) {
    case "create_measurable":
      return { title: `Add measurable "${p.name}"`, details: [cad(p), ...(p.description ? [String(p.description)] : [])] };
    case "edit_measurable": {
      const item = await getItem(sql, userId, p.itemId as string);
      const name = item?.current.name ?? "a measurable";
      const changes: string[] = [];
      if (p.name) changes.push(`Rename to "${p.name}"`);
      if (p.cadence || p.scheduleType || p.daysOfWeek || p.targetCount !== undefined) {
        const merged = { ...(item ? { cadence: item.current.cadence, scheduleType: item.current.scheduleType, daysOfWeek: item.current.daysOfWeek, targetCount: item.current.targetCount } : {}), ...p };
        changes.push(`Schedule: ${cad(merged)}`);
      }
      if (p.dueTime !== undefined) changes.push(p.dueTime ? `Due at ${p.dueTime}` : "Remove due time");
      if (p.description !== undefined) changes.push("Update description");
      if (p.milestoneId !== undefined) changes.push(p.milestoneId ? "Link to a milestone" : "Unlink milestone");
      return { title: `Change "${name}"`, details: changes };
    }
    case "archive_measurable": {
      const item = await getItem(sql, userId, p.itemId as string);
      return { title: `Archive "${item?.current.name ?? "measurable"}"`, details: ["Past days keep their answers and grades."] };
    }
    case "create_milestone":
      return { title: `Add milestone "${p.title}"`, details: [p.horizon === "5y" ? "Five-year horizon" : p.horizon === "1y" ? "One-year horizon" : "Milestone", ...(p.targetDate ? [`Target ${p.targetDate}`] : [])] };
    case "edit_milestone": {
      const [m] = await sql`select title from milestones where id = ${p.milestoneId as string} and user_id = ${userId}`;
      const changes = Object.entries(p).filter(([k]) => k !== "milestoneId").map(([k, v]) => `${k === "targetDate" ? "Target date" : k[0].toUpperCase() + k.slice(1)}: ${v ?? "none"}`);
      return { title: `Change milestone "${m?.title ?? ""}"`, details: changes };
    }
    case "update_vision":
      return { title: "Update your vision", details: [String(p.identity), String(p.statement)] };
  }
}

export async function listProposals(sql: Sql, userId: string, status: "pending" | "all" = "pending"): Promise<Proposal[]> {
  const rows = await sql`select * from proposals where user_id = ${userId} ${status === "pending" ? sql`and status = 'pending'` : sql``}
                         order by created_at desc limit 50`;
  const out: Proposal[] = [];
  for (const r of rows as Row[]) {
    const kind = r.kind as ProposalKind;
    const payload = r.payload as Record<string, unknown>;
    const d = await describe(sql, userId, kind, payload).catch(() => ({ title: kind, details: [] }));
    out.push({
      id: r.id as string,
      sessionId: (r.session_id as string) ?? null,
      kind,
      payload,
      rationale: r.rationale as string,
      status: r.status as Proposal["status"],
      error: (r.error as string) ?? null,
      createdAt: (r.created_at as Date).toISOString(),
      decidedAt: r.decided_at ? (r.decided_at as Date).toISOString() : null,
      ...d,
    });
  }
  return out;
}

/** Applies (approve) or rejects a pending proposal. Re-validates everything before applying. */
export async function decideProposal(sql: Sql, userId: string, id: string, approve: boolean, now = new Date()) {
  const [r] = await sql`select * from proposals where id = ${id} and user_id = ${userId}`;
  if (!r) throw new NotFoundError("Proposal not found.");
  if (r.status !== "pending") throw new HttpError(409, "This proposal was already decided.");
  if (!approve) {
    await sql`update proposals set status = 'rejected', decided_at = ${now} where id = ${id}`;
    return { status: "rejected" as const };
  }
  try {
    const { kind, payload: p } = await validateProposal(sql, userId, r.kind as string, r.payload);
    switch (kind) {
      case "create_measurable": {
        const today = currentDay(now, await getSettings(sql, userId, { now }));
        await createItem(sql, userId, toItemInput(p, undefined, today), now, id);
        break;
      }
      case "edit_measurable": {
        const item = await getItem(sql, userId, p.itemId as string);
        if (!item) throw new NotFoundError("That measurable no longer exists.");
        const v = item.current;
        const base: ItemInput = { ...v, rules: item.rules };
        await updateItem(sql, userId, item.id, { ...toItemInput(p, base), rules: item.rules }, now, id);
        break;
      }
      case "archive_measurable":
        await setItemStatus(sql, userId, p.itemId as string, "archived", now, id);
        break;
      case "create_milestone":
        await createMilestone(sql, userId, milestoneSchema.parse(p), "proposal");
        break;
      case "edit_milestone": {
        const { milestoneId, ...rest } = p;
        await updateMilestone(sql, userId, milestoneId as string, rest);
        break;
      }
      case "update_vision":
        await saveVision(sql, userId, visionSchema.parse(p), "proposal", id);
        break;
    }
    await sql`update proposals set status = 'applied', decided_at = ${now} where id = ${id}`;
    return { status: "applied" as const };
  } catch (e) {
    const msg = e instanceof z.ZodError ? "The suggested change isn't valid anymore." : (e as Error).message;
    await sql`update proposals set status = 'failed', error = ${msg.slice(0, 300)}, decided_at = ${now} where id = ${id}`;
    return { status: "failed" as const, error: msg };
  }
}

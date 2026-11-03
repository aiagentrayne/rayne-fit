/** The user's life vision (versioned) and milestones. */
import { z } from "zod";
import { tx, type Sql } from "./db";
import { NotFoundError } from "./items";
import { isLocalDate, type LocalDate } from "@/lib/core/time";

export interface Vision {
  id: string;
  version: number;
  identity: string;
  statement: string;
  oneYear: string;
  fiveYear: string;
  source: "user" | "proposal";
  createdAt: string;
}

export interface Milestone {
  id: string;
  title: string;
  detail: string | null;
  horizon: "1y" | "5y" | "other";
  targetDate: LocalDate | null;
  status: "active" | "achieved" | "dropped";
  source: "user" | "proposal";
}

type Row = Record<string, unknown>;

const mapVision = (r: Row): Vision => ({
  id: r.id as string,
  version: Number(r.version),
  identity: r.identity as string,
  statement: r.statement as string,
  oneYear: r.one_year as string,
  fiveYear: r.five_year as string,
  source: r.source as Vision["source"],
  createdAt: (r.created_at as Date).toISOString(),
});

const mapMilestone = (r: Row): Milestone => ({
  id: r.id as string,
  title: r.title as string,
  detail: (r.detail as string) ?? null,
  horizon: r.horizon as Milestone["horizon"],
  targetDate: (r.target_date as LocalDate) ?? null,
  status: r.status as Milestone["status"],
  source: r.source as Milestone["source"],
});

export const visionSchema = z.object({
  identity: z.string().trim().min(1, "Describe who you want to become.").max(2000),
  statement: z.string().trim().min(1, "Write your vision.").max(4000),
  oneYear: z.string().trim().max(2000).default(""),
  fiveYear: z.string().trim().max(2000).default(""),
});

export async function getVision(sql: Sql, userId: string): Promise<Vision | null> {
  const [r] = await sql`select * from visions where user_id = ${userId} and status = 'active'`;
  return r ? mapVision(r) : null;
}

export async function visionHistory(sql: Sql, userId: string): Promise<Vision[]> {
  return (await sql`select * from visions where user_id = ${userId} order by version desc limit 20`).map(mapVision);
}

/** Saves a new version of the vision; earlier versions are kept as history. */
export async function saveVision(sql: Sql, userId: string, input: z.input<typeof visionSchema>, source: "user" | "proposal" = "user", proposalId: string | null = null): Promise<Vision> {
  const v = visionSchema.parse(input);
  return tx(sql, async (t) => {
    await t`select pg_advisory_xact_lock(hashtext(${"vision:" + userId}))`;
    const [{ next }] = await t`select coalesce(max(version), 0) + 1 as next from visions where user_id = ${userId}`;
    await t`update visions set status = 'superseded' where user_id = ${userId} and status = 'active'`;
    const [r] = await t`insert into visions (user_id, version, identity, statement, one_year, five_year, source, proposal_id)
                        values (${userId}, ${next}, ${v.identity}, ${v.statement}, ${v.oneYear}, ${v.fiveYear}, ${source}, ${proposalId}) returning *`;
    return mapVision(r);
  });
}

/** The date the current vision was first saved (start of the quarterly-review cycle). */
export async function visionStartDate(sql: Sql, userId: string, tz: string): Promise<LocalDate | null> {
  const [r] = await sql`select (min(created_at) at time zone ${tz})::date::text as d from visions where user_id = ${userId}`;
  return (r?.d as LocalDate) ?? null;
}

export const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Give the milestone a title.").max(200),
  detail: z.string().trim().max(1000).nullable().optional(),
  horizon: z.enum(["1y", "5y", "other"]).default("1y"),
  targetDate: z.string().refine(isLocalDate, "Invalid date.").nullable().optional(),
  status: z.enum(["active", "achieved", "dropped"]).default("active"),
});

export async function listMilestones(sql: Sql, userId: string, includeClosed = true): Promise<Milestone[]> {
  const rows = await sql`select * from milestones where user_id = ${userId} ${includeClosed ? sql`` : sql`and status = 'active'`}
                         order by case status when 'active' then 0 when 'achieved' then 1 else 2 end, horizon, target_date nulls last, created_at`;
  return rows.map(mapMilestone);
}

export async function createMilestone(sql: Sql, userId: string, input: z.input<typeof milestoneSchema>, source: "user" | "proposal" = "user"): Promise<Milestone> {
  const m = milestoneSchema.parse(input);
  const [r] = await sql`insert into milestones (user_id, title, detail, horizon, target_date, status, source)
                        values (${userId}, ${m.title}, ${m.detail ?? null}, ${m.horizon}, ${m.targetDate ?? null}, ${m.status}, ${source}) returning *`;
  return mapMilestone(r);
}

export async function updateMilestone(sql: Sql, userId: string, id: string, input: Partial<z.input<typeof milestoneSchema>>): Promise<Milestone> {
  const [cur] = await sql`select * from milestones where id = ${id} and user_id = ${userId}`;
  if (!cur) throw new NotFoundError("Milestone not found.");
  const m = milestoneSchema.parse({ ...mapMilestone(cur), ...input });
  const [r] = await sql`update milestones set title = ${m.title}, detail = ${m.detail ?? null}, horizon = ${m.horizon}, target_date = ${m.targetDate ?? null},
                        status = ${m.status}, updated_at = now() where id = ${id} and user_id = ${userId} returning *`;
  return mapMilestone(r);
}

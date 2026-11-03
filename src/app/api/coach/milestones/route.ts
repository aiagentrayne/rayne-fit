import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { createMilestone, listMilestones, milestoneSchema } from "@/server/vision";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId) => json({ milestones: await listMilestones(db(), userId) }));

export const POST = authed(async (userId, req) => {
  const m = await body(req, milestoneSchema);
  return json({ milestone: await createMilestone(db(), userId, m, "user") }, 201);
});

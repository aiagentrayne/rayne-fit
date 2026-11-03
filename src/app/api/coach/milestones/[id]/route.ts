import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { milestoneSchema, updateMilestone } from "@/server/vision";

export const dynamic = "force-dynamic";

export const PATCH = authed<{ id: string }>(async (userId, req, p) => {
  const patch = await body(req, milestoneSchema.partial());
  return json({ milestone: await updateMilestone(db(), userId, z.string().uuid().parse(p.id), patch) });
});

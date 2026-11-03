import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { finishSchema, finishSession } from "@/server/coach/sessions";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = authed<{ id: string }>(async (userId, req, p) => {
  const b = await body(req, finishSchema);
  const sql = db();
  const data = await finishSession(sql, userId, z.string().uuid().parse(p.id), b.keepCommitmentIds);
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json(data);
});

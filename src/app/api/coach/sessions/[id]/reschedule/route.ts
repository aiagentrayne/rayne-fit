import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { rescheduleSchema, rescheduleSession } from "@/server/coach/sessions";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (userId, req, p) => {
  const b = await body(req, rescheduleSchema);
  const sql = db();
  await rescheduleSession(sql, userId, z.string().uuid().parse(p.id), new Date(b.dueAt));
  await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ ok: true });
});

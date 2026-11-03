import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { logCompletion, logSchema, undoCompletion } from "@/server/tracking";
import { isLocalDate } from "@/lib/core/time";

export const dynamic = "force-dynamic";

export const POST = authed(async (userId, req) => {
  await logCompletion(db(), userId, await body(req, logSchema));
  return json({ ok: true });
});

export const DELETE = authed(async (userId, req) => {
  const q = new URL(req.url).searchParams;
  const { itemId, date } = z.object({ itemId: z.string().uuid(), date: z.string().refine(isLocalDate) }).parse({ itemId: q.get("itemId"), date: q.get("date") });
  await undoCompletion(db(), userId, itemId, date);
  return json({ ok: true });
});

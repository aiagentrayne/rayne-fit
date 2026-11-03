import { z } from "zod";
import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { HttpError } from "@/server/auth";
import { checkinSchema, deleteCheckin, getCheckinDay, saveCheckin } from "@/server/tracking";
import { isLocalDate } from "@/lib/core/time";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId, req) => {
  const d = new URL(req.url).searchParams.get("date");
  if (d && !isLocalDate(d)) throw new HttpError(400, "Invalid date.");
  return json(await getCheckinDay(db(), userId, d));
});

export const POST = authed(async (userId, req) => {
  const input = await body(req, checkinSchema);
  const sql = db();
  const r = await saveCheckin(sql, userId, input);
  return json({ ...(await getCheckinDay(sql, userId, input.date)), crisis: r.crisis });
});

export const DELETE = authed(async (userId, req) => {
  const q = new URL(req.url).searchParams;
  const { date, metric } = z.object({ date: z.string().refine(isLocalDate), metric: z.enum(["energy", "mood", "stress"]) }).parse({ date: q.get("date"), metric: q.get("metric") });
  const sql = db();
  await deleteCheckin(sql, userId, date, metric);
  return json(await getCheckinDay(sql, userId, date));
});

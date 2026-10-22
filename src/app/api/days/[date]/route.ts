import { db } from "@/server/db";
import { HttpError } from "@/server/auth";
import { authed, json } from "@/server/http";
import { getDay } from "@/server/days";
import { listCorrections } from "@/server/responses";
import { isLocalDate } from "@/lib/core/time";

export const dynamic = "force-dynamic";

export const GET = authed<{ date: string }>(async (userId, _req, { date }) => {
  if (!isLocalDate(date)) throw new HttpError(400, "Invalid date");
  const sql = db();
  const day = await getDay(sql, userId, date);
  return json({ day: day?.day ?? null, items: day?.items ?? [], corrections: await listCorrections(sql, userId, date) });
});

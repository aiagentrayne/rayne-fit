import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { journalSchema, saveJournal } from "@/server/tracking";

export const dynamic = "force-dynamic";

export const PUT = authed(async (userId, req) => {
  const { date, body: text } = await body(req, journalSchema);
  return json(await saveJournal(db(), userId, date, text));
});

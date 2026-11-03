import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { startSchema, startSession } from "@/server/coach/sessions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Starts or resumes an interview; ROSS asks its first question. */
export const POST = authed(async (userId, req) => {
  const input = await body(req, startSchema);
  return json(await startSession(db(), userId, input));
});

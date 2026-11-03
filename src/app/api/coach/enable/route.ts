import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { setRossEnabled } from "@/server/settings";
import { planForUser } from "@/server/notifications";
import { ensureScheduledSessions } from "@/server/coach/sessions";

export const dynamic = "force-dynamic";

const schema = z.object({ enabled: z.boolean(), shareCheckins: z.boolean().default(true), shareJournal: z.boolean().default(false), consent: z.boolean().optional() });

/** Turning ROSS on requires the consent checkbox; turning it off never deletes data. */
export const POST = authed(async (userId, req) => {
  const b = await body(req, schema);
  if (b.enabled && !b.consent) return json({ error: "Please confirm you've read what ROSS shares with OpenAI." }, 400);
  const sql = db();
  const now = new Date();
  const settings = await setRossEnabled(sql, userId, b.enabled, b.enabled ? { shareCheckins: b.shareCheckins, shareJournal: b.shareJournal } : null, now);
  if (b.enabled) await bestEffort("sessions", () => ensureScheduledSessions(sql, userId, settings, now));
  await bestEffort("replan", () => planForUser(sql, userId, now));
  return json({ settings });
});

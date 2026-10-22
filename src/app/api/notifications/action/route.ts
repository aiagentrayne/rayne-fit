import { z } from "zod";
import { db } from "@/server/db";
import { body, json, open } from "@/server/http";
import { handleNotificationAction } from "@/server/notifications";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(10).max(300), action: z.enum(["yes", "no", "snooze", "open"]) });

/**
 * Called by the service worker when the user taps a notification action. Authorized by the
 * signed token in the push payload (bound to one queued notification), not by cookies.
 */
export const POST = open(async (req) => {
  const { token, action } = await body(req, schema);
  const res = await handleNotificationAction(db(), token, action);
  if (!res.ok) return json({ error: res.error }, res.error === "invalid_token" ? 403 : 404);
  return json({ ok: true, duplicate: res.duplicate });
});

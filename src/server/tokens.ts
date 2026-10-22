import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed tokens embedded in push payloads so notification actions (Mark YES/NO, Snooze)
 * can only touch the exact queued notification they were issued for, even when the
 * service worker has no session cookie.
 */
function secret(): string {
  const s = process.env.ACTION_TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error("ACTION_TOKEN_SECRET must be set (32+ characters)");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeActionToken(queueId: string): string {
  return `${queueId}.${sign(`notif:${queueId}`)}`;
}

export function verifyActionToken(token: string): string | null {
  const [queueId, sig] = token.split(".");
  if (!queueId || !sig) return null;
  const expected = Buffer.from(sign(`notif:${queueId}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return queueId;
}

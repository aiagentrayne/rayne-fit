import { db } from "@/server/db";
import { authed } from "@/server/http";

export const dynamic = "force-dynamic";

/** Download everything stored about the signed-in user (data portability). */
export const GET = authed(async (userId) => {
  const sql = db();
  const tables = ["user_settings", "items", "item_versions", "item_notification_rules", "day_records", "day_items", "corrections", "response_events"] as const;
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  for (const t of tables) out[t] = await sql`select * from ${sql(t)} where user_id = ${userId}`;
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="rayne-fit-export.json"`, "Cache-Control": "no-store" },
  });
});

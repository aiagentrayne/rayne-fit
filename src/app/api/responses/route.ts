import { z } from "zod";
import { db } from "@/server/db";
import { authed, bestEffort, body, json } from "@/server/http";
import { responseInputSchema, writeResponse, type ResponseResult } from "@/server/responses";
import { planForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";

const batchSchema = z.object({ mutations: z.array(responseInputSchema).min(1).max(200) });

/** Accepts one or many check-ins (offline outbox replays send a batch, oldest first). */
export const POST = authed(async (userId, req) => {
  const { mutations } = await body(req, batchSchema);
  const sql = db();
  const results: ResponseResult[] = [];
  for (const m of mutations) {
    results.push(
      await writeResponse(sql, userId, {
        mutationId: m.mutationId,
        date: m.date,
        itemId: m.itemId,
        value: m.value,
        clientTime: new Date(m.clientTime),
        source: m.source,
        isCorrection: false,
      }),
    );
  }
  if (results.some((r) => r.outcome === "apply" && r.value === null)) await bestEffort("replan", () => planForUser(sql, userId, new Date()));
  return json({ results });
});

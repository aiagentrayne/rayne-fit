import { db } from "@/server/db";
import { authed, body, json } from "@/server/http";
import { correctionInputSchema, listCorrections, writeResponse } from "@/server/responses";

export const dynamic = "force-dynamic";

export const GET = authed(async (userId, req) => {
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  return json({ corrections: await listCorrections(db(), userId, date) });
});

/** Explicit correction of a finalized day. Audited with old/new value, time and reason. */
export const POST = authed(async (userId, req) => {
  const c = await body(req, correctionInputSchema);
  const result = await writeResponse(db(), userId, {
    mutationId: c.mutationId,
    date: c.date,
    itemId: c.itemId,
    value: c.value,
    clientTime: new Date(),
    source: "correction",
    isCorrection: true,
    reason: c.reason ?? null,
  });
  return json({ result });
});

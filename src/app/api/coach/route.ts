import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { getCoachHub } from "@/server/coach/hub";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = authed(async (userId) => json(await getCoachHub(db(), userId, new Date())));

import { db } from "@/server/db";
import { authed, json } from "@/server/http";
import { HttpError } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { transcribe } from "@/server/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

/** Push-to-talk: audio goes to OpenAI for transcription and is never stored. Returns text only. */
export const POST = authed(async (userId, req) => {
  const sql = db();
  const s = await getSettings(sql, userId);
  if (!s.rossEnabled) throw new HttpError(403, "Turn on ROSS first.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob)) throw new HttpError(400, "No audio received.");
  if (file.size === 0) throw new HttpError(400, "That recording was empty.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Recording too long. Keep voice notes under about two minutes.");
  const type = file.type || "audio/webm";
  const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  const text = await transcribe(sql, userId, file, `voice.${ext}`);
  return json({ text });
});

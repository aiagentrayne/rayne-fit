import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { HttpError, requireUserId } from "./auth";
import { NotFoundError } from "./items";
import { AiUnavailableError } from "./llm";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof NotFoundError) return json({ error: e.message }, 404);
  if (e instanceof AiUnavailableError) {
    const msg =
      e.reason === "not_configured" ? "ROSS isn't connected to OpenAI yet." :
      e.reason === "budget_user" || e.reason === "budget_global" ? e.message :
      "ROSS couldn't answer just now. Your progress is saved; try again in a moment.";
    return json({ error: msg, reason: e.reason }, 503);
  }
  if (e instanceof ZodError) return json({ error: e.issues[0]?.message ?? "Invalid input", issues: e.issues }, 400);
  console.error(e);
  return json({ error: "Something went wrong" }, 500);
}

type Ctx<P> = { params: Promise<P> };

/** Wraps an authenticated route: resolves the user, maps errors to HTTP responses. */
export function authed<P = Record<string, string>>(fn: (userId: string, req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const userId = await requireUserId();
      return await fn(userId, req, (await ctx?.params) as P);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function open(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  return schema.parse(raw);
}

/** Runs a follow-up (e.g. re-planning reminders) without failing the request if it errors. */
export async function bestEffort(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[${label}]`, e);
  }
}

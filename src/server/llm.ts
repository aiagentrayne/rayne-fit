/**
 * The LLM gateway: the only module that talks to OpenAI. Every call is server-side, checked
 * against consent and token budgets, and logged to ai_calls (tokens, cost, latency; never the
 * message text). The API key lives only in the server environment.
 */
import type { Sql } from "./db";

export const MODELS = {
  coach: () => process.env.OPENAI_MODEL_COACH || "gpt-6.1-sol",
  nugget: () => process.env.OPENAI_MODEL_NUGGET || "gpt-6.1-terra",
  transcribe: () => process.env.OPENAI_MODEL_TRANSCRIBE || "gpt-transcribe",
};

/** USD per 1M tokens [input, output], for cost estimates only. Unknown models log no cost. */
const PRICES: Record<string, [number, number]> = {
  "gpt-6-astra": [10, 50],
  "gpt-6.1-sol": [2, 10],
  "gpt-6.1-terra": [1, 5],
  "gpt-6-luna": [0.1, 0.5],
};

const USER_MONTHLY_TOKENS = () => Number(process.env.ROSS_USER_MONTHLY_TOKENS || 600_000);
const GLOBAL_DAILY_TOKENS = () => Number(process.env.ROSS_GLOBAL_DAILY_TOKENS || 5_000_000);
const TIMEOUT_MS = 45_000;

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export class AiUnavailableError extends Error {
  constructor(public reason: "not_configured" | "budget_user" | "budget_global" | "upstream" | "timeout" | "bad_output", message?: string) {
    super(message ?? reason);
  }
}

export function estimateCost(model: string, inTok: number, outTok: number): number | null {
  const p = PRICES[model];
  return p ? (inTok * p[0] + outTok * p[1]) / 1_000_000 : null;
}

async function log(sql: Sql, userId: string | null, purpose: string, model: string, inTok: number, outTok: number, latency: number, outcome: string) {
  try {
    await sql`insert into ai_calls (user_id, purpose, model, input_tokens, output_tokens, cost_usd, latency_ms, outcome)
              values (${userId}, ${purpose}, ${model}, ${inTok}, ${outTok}, ${estimateCost(model, inTok, outTok)}, ${latency}, ${outcome})`;
  } catch (e) {
    console.error("[ai_calls]", e);
  }
}

/** Throws AiUnavailableError when AI is off or a budget is spent. */
export async function checkBudget(sql: Sql, userId: string) {
  if (!aiConfigured()) throw new AiUnavailableError("not_configured", "ROSS isn't connected to OpenAI yet.");
  const [u] = await sql`select coalesce(sum(input_tokens + output_tokens), 0)::bigint as n from ai_calls
                        where user_id = ${userId} and created_at >= date_trunc('month', now())`;
  if (Number(u.n) >= USER_MONTHLY_TOKENS()) throw new AiUnavailableError("budget_user", "ROSS has reached this month's usage limit for your account.");
  const [g] = await sql`select coalesce(sum(input_tokens + output_tokens), 0)::bigint as n from ai_calls where created_at >= now() - interval '1 day'`;
  if (Number(g.n) >= GLOBAL_DAILY_TOKENS()) throw new AiUnavailableError("budget_global", "ROSS is resting after a busy day. Try again later.");
}

export interface JsonCall {
  userId: string;
  purpose: "interview" | "nugget" | "summary";
  model: string;
  instructions: string;
  /** Conversation turns. User-written text must already be wrapped as data by the caller. */
  input: { role: "user" | "assistant" | "developer"; content: string }[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

interface ResponsesOutput {
  output?: { type: string; phase?: string; content?: { type: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string } | null;
  status?: string;
}

/** Extracts the final answer text, skipping any "commentary" phase messages. */
export function outputText(r: ResponsesOutput): string {
  const parts: string[] = [];
  for (const item of r.output ?? []) {
    if (item.type !== "message" || item.phase === "commentary") continue;
    for (const c of item.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("");
}

/**
 * Calls the Responses API with a strict JSON schema and returns the parsed object. The
 * result still has to be validated by the caller (it is model output, not trusted input).
 */
export async function callJson<T>(sql: Sql, c: JsonCall): Promise<T> {
  await checkBudget(sql, c.userId);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        instructions: c.instructions,
        input: c.input,
        store: false,
        max_output_tokens: c.maxOutputTokens ?? 2000,
        text: { format: { type: "json_schema", name: c.schemaName, schema: c.schema, strict: true } },
        ...(process.env.OPENAI_REASONING_EFFORT ? { reasoning: { effort: process.env.OPENAI_REASONING_EFFORT } } : {}),
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = (e as Error).name === "AbortError";
    await log(sql, c.userId, c.purpose, c.model, 0, 0, Date.now() - started, timedOut ? "timeout" : "network_error");
    throw new AiUnavailableError(timedOut ? "timeout" : "upstream");
  }
  clearTimeout(timer);
  const data = (await res.json().catch(() => ({}))) as ResponsesOutput;
  const inTok = data.usage?.input_tokens ?? 0;
  const outTok = data.usage?.output_tokens ?? 0;
  if (!res.ok) {
    await log(sql, c.userId, c.purpose, c.model, inTok, outTok, Date.now() - started, `http_${res.status}`);
    console.error("[openai]", res.status, data.error?.message);
    throw new AiUnavailableError("upstream");
  }
  const text = outputText(data);
  try {
    const parsed = JSON.parse(text) as T;
    await log(sql, c.userId, c.purpose, c.model, inTok, outTok, Date.now() - started, "ok");
    return parsed;
  } catch {
    await log(sql, c.userId, c.purpose, c.model, inTok, outTok, Date.now() - started, data.status === "incomplete" ? "incomplete" : "bad_json");
    throw new AiUnavailableError("bad_output");
  }
}

/** Speech-to-text. The audio is streamed to OpenAI and never stored by Rayne Fit. */
export async function transcribe(sql: Sql, userId: string, audio: Blob, filename: string): Promise<string> {
  await checkBudget(sql, userId);
  const model = MODELS.transcribe();
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  form.append("response_format", "json");
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    await log(sql, userId, "transcribe", model, 0, 0, Date.now() - started, "network_error");
    throw new AiUnavailableError("upstream");
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  await log(sql, userId, "transcribe", model, data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0, Date.now() - started, res.ok ? "ok" : `http_${res.status}`);
  if (!res.ok || typeof data.text !== "string") throw new AiUnavailableError("upstream");
  return data.text.trim();
}

/**
 * Wraps text the user wrote (journal notes, check-in notes, measurable names) so the model
 * treats it as quoted data. Angle brackets are neutralised so it cannot close the wrapper.
 */
export function asData(label: string, text: string): string {
  const safe = text.replace(/</g, "‹").replace(/>/g, "›");
  return `<${label}>\n${safe}\n</${label}>`;
}

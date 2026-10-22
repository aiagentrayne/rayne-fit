import type { ResponseValue } from "./scoring";

export type ResponseSource = "app" | "notification" | "offline" | "correction" | "auto";

export interface ExistingResponse {
  value: ResponseValue;
  /** When the current value was recorded (client time for user answers, cutoff for auto-NO). */
  respondedAt: Date | null;
  autoFinalized: boolean;
}

export interface IncomingResponse {
  value: ResponseValue;
  /** Device time at which the user tapped. Clamped to the server clock. */
  clientTime: Date;
  receivedAt: Date;
  source: ResponseSource;
  /** True for an explicit correction to a finalized day from the history screen. */
  isCorrection: boolean;
}

export interface DayState {
  status: "open" | "final";
  cutoffAt: Date;
}

/** Offline answers captured before the cutoff are honoured if they sync within this window. */
export const OFFLINE_GRACE_HOURS = 72;
/** Device clocks running ahead of the server are clamped to the server clock. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export type Resolution =
  | { outcome: "apply"; effectiveTime: Date; audit: null | "late_offline_sync" | "correction" }
  | { outcome: "noop"; reason: "same_value" }
  | { outcome: "stale"; reason: "newer_answer_on_server" }
  | { outcome: "reject"; reason: "day_finalized" | "cannot_clear_final" | "after_cutoff" };

export function effectiveClientTime(incoming: IncomingResponse): Date {
  const limit = incoming.receivedAt.getTime() + MAX_CLOCK_SKEW_MS;
  return incoming.clientTime.getTime() > limit ? incoming.receivedAt : incoming.clientTime;
}

/**
 * Explicit conflict policy for check-ins (used for online, offline and notification writes):
 *  1. Open day: last write wins by the time the user tapped. An older offline tap that
 *     arrives after a newer one is ignored and the client is told the server value.
 *  2. Finalized day: only an explicit correction (audited) may change it, except that an
 *     offline answer tapped BEFORE the cutoff and synced within the grace window replaces
 *     the automatic NO (also audited as a late offline sync).
 *  3. Writing the same value again is a no-op, which makes retries idempotent.
 */
export function resolveResponse(existing: ExistingResponse, incoming: IncomingResponse, day: DayState): Resolution {
  const t = effectiveClientTime(incoming);
  if (day.status === "open") {
    if (incoming.receivedAt.getTime() >= day.cutoffAt.getTime() && !incoming.isCorrection) {
      return { outcome: "reject", reason: "after_cutoff" };
    }
    if (existing.respondedAt && t.getTime() < existing.respondedAt.getTime()) return { outcome: "stale", reason: "newer_answer_on_server" };
    if (existing.value === incoming.value) return { outcome: "noop", reason: "same_value" };
    return { outcome: "apply", effectiveTime: t, audit: null };
  }

  if (incoming.value === null) return { outcome: "reject", reason: "cannot_clear_final" };
  if (incoming.isCorrection) {
    if (existing.value === incoming.value) return { outcome: "noop", reason: "same_value" };
    return { outcome: "apply", effectiveTime: incoming.receivedAt, audit: "correction" };
  }
  const tappedBeforeCutoff = t.getTime() < day.cutoffAt.getTime();
  const withinGrace = incoming.receivedAt.getTime() - day.cutoffAt.getTime() <= OFFLINE_GRACE_HOURS * 3600_000;
  if (incoming.source === "offline" && tappedBeforeCutoff && withinGrace) {
    if (!existing.autoFinalized && existing.respondedAt && t.getTime() < existing.respondedAt.getTime()) {
      return { outcome: "stale", reason: "newer_answer_on_server" };
    }
    if (existing.value === incoming.value) return { outcome: "noop", reason: "same_value" };
    return { outcome: "apply", effectiveTime: t, audit: "late_offline_sync" };
  }
  return { outcome: "reject", reason: "day_finalized" };
}

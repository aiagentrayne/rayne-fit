"use client";

import { get, set, update } from "idb-keyval";
import { newMutationId } from "./api";

/** A check-in captured on this device, waiting to reach the server. */
export interface PendingMutation {
  mutationId: string;
  date: string;
  itemId: string;
  value: "yes" | "no" | null;
  clientTime: string;
  source: "app" | "offline";
}

export interface SyncResult {
  mutationId?: string;
  outcome: string;
  reason?: string;
  date: string;
  itemId: string;
  value: "yes" | "no" | null;
}

const OUTBOX = "outbox";

export async function readOutbox(): Promise<PendingMutation[]> {
  try {
    return (await get<PendingMutation[]>(OUTBOX)) ?? [];
  } catch {
    return [];
  }
}

/**
 * Records a tap locally first. Only the latest tap per (date, item) is kept: the server
 * resolves conflicts by tap time, so older taps for the same item would be ignored anyway.
 */
export async function enqueue(date: string, itemId: string, value: PendingMutation["value"]): Promise<PendingMutation> {
  const m: PendingMutation = { mutationId: newMutationId(), date, itemId, value, clientTime: new Date().toISOString(), source: "app" };
  await update<PendingMutation[]>(OUTBOX, (list = []) => [...list.filter((x) => !(x.date === date && x.itemId === itemId)), m]);
  return m;
}

let flushing: Promise<SyncResult[] | null> | null = null;

/**
 * Sends everything in the outbox. Mutations that were captured while offline are marked
 * `offline` so the server can apply its late-sync policy. Safe to call repeatedly:
 * mutation ids make retries idempotent.
 */
export function flush(): Promise<SyncResult[] | null> {
  if (flushing) return flushing;
  flushing = flushOnce().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function flushOnce(): Promise<SyncResult[] | null> {
  {
    const list = await readOutbox();
    if (!list.length) return [];
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    const ageMs = (m: PendingMutation) => Date.now() - Date.parse(m.clientTime);
    const payload = list.map((m) => ({ ...m, source: m.source === "offline" || ageMs(m) > 15_000 ? "offline" : "app" }));
    try {
      const res = await fetch("/api/responses", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: payload }),
      });
      if (!res.ok) {
        // 4xx (other than auth) means the batch itself is invalid: drop it rather than retry forever.
        if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
          await set(OUTBOX, (await readOutbox()).filter((m) => !list.some((x) => x.mutationId === m.mutationId)));
        }
        return null;
      }
      const { results } = (await res.json()) as { results: SyncResult[] };
      const sent = new Set(list.map((m) => m.mutationId));
      await update<PendingMutation[]>(OUTBOX, (cur = []) => cur.filter((m) => !sent.has(m.mutationId)));
      return results.map((r, i) => ({ ...r, mutationId: list[i]?.mutationId }));
    } catch {
      await update<PendingMutation[]>(OUTBOX, (cur = []) => cur.map((m) => (wasSent(m) ? { ...m, source: "offline" as const } : m)));
      return null;
    }
    function wasSent(m: PendingMutation) {
      return list.some((x) => x.mutationId === m.mutationId);
    }
  }
}

/** Asks the service worker to retry in the background where Background Sync exists (not iOS). */
export async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync;
    await sync?.register("flush-outbox");
  } catch {
    /* unsupported */
  }
}

export async function cacheSet<T>(key: string, value: T) {
  try {
    await set(`cache:${key}`, value);
  } catch {
    /* storage unavailable */
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(`cache:${key}`);
  } catch {
    return undefined;
  }
}

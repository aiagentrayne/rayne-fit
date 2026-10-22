"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { flush, readOutbox, requestBackgroundSync, type SyncResult } from "@/client/offline";
import { registerServiceWorker } from "@/client/push";

type SyncState = "synced" | "syncing" | "pending" | "offline";

interface ShellCtx {
  online: boolean;
  sync: SyncState;
  pendingCount: number;
  /** Bumped whenever server data may have changed (sync finished, notification action). */
  version: number;
  lastSyncIssues: SyncResult[];
  syncNow: () => Promise<void>;
  refreshPending: () => Promise<void>;
}

const Ctx = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell outside AppShell");
  return c;
}

const ISSUE_OUTCOMES = new Set(["reject", "stale", "not_found", "future"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(0);
  const [issues, setIssues] = useState<SyncResult[]>([]);

  const refreshPending = useCallback(async () => setPending((await readOutbox()).length), []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const results = await flush();
      if (results === null) await requestBackgroundSync();
      else if (results.length) {
        setIssues(results.filter((r) => ISSUE_OUTCOMES.has(r.outcome)));
        setVersion((v) => v + 1);
      }
    } finally {
      setSyncing(false);
      await refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void registerServiceWorker();
    void refreshPending().then(() => syncNow());
    const on = () => {
      setOnline(true);
      void syncNow();
    };
    const off = () => setOnline(false);
    const visible = () => {
      if (document.visibilityState === "visible") {
        void syncNow();
        setVersion((v) => v + 1);
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "REFRESH" || e.data?.type === "OUTBOX_SYNCED") {
        setVersion((v) => v + 1);
        void refreshPending();
      }
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", visible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const timer = setInterval(() => void syncNow(), 30_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", visible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [refreshPending, syncNow]);

  const sync: SyncState = !online ? "offline" : syncing ? "syncing" : pendingCount > 0 ? "pending" : "synced";
  return <Ctx.Provider value={{ online, sync, pendingCount, version, lastSyncIssues: issues, syncNow, refreshPending }}>{children}</Ctx.Provider>;
}

export function SyncPill() {
  const { sync, pendingCount, syncNow } = useShell();
  const label =
    sync === "offline" ? `Offline${pendingCount ? ` · ${pendingCount} saved on device` : ""}` : sync === "syncing" ? "Syncing…" : sync === "pending" ? `${pendingCount} waiting to sync` : "Synced";
  const color = sync === "synced" ? "border-lime/50 text-lime" : sync === "offline" ? "border-orange text-orange" : "border-hardhat text-hardhat";
  return (
    <button type="button" onClick={() => void syncNow()} className={`rounded-full border px-3 py-1 text-xs font-semibold ${color}`} aria-live="polite" title="Tap to sync now">
      <span aria-hidden="true">{sync === "synced" ? "● " : sync === "offline" ? "○ " : "◐ "}</span>
      {label}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { Nugget } from "@/client/types";

const LABEL: Record<Nugget["category"], string> = { accountability: "Accountability", educational: "Know-how", motivational: "Fuel" };

export function NuggetCard({ nugget, highlight }: { nugget: Nugget; highlight?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nugget.readAt) void api(`/api/coach/nuggets/${nugget.id}/read`, { method: "POST" }).catch(() => {});
  }, [nugget.id, nugget.readAt]);

  async function discuss() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ session: { id: string } }>("/api/coach/sessions", { method: "POST", json: { kind: "nugget_chat", nuggetId: nugget.id } });
      router.push(`/coach/session/${r.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section aria-label="Today's nugget from ROSS" className={`rounded-2xl border-l-4 border-lime bg-panel p-4 ${highlight ? "ring-2 ring-lime" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="font-display text-sm tracking-widest text-lime">ROSS</p>
        <span className="rounded-full border border-concrete px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-muted">{LABEL[nugget.category]}</span>
      </div>
      <p className="mt-2 text-base leading-snug">{nugget.body}</p>
      {nugget.fallback && <p className="mt-2 text-xs text-muted">Quick tip (ROSS&apos;s AI was unavailable, so this one is from the standard set).</p>}
      <button type="button" onClick={() => void discuss()} disabled={busy} className="mt-3 text-sm font-semibold text-lime underline disabled:opacity-60">
        {busy ? "Opening…" : "Talk about this"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-no">{error}</p>}
    </section>
  );
}

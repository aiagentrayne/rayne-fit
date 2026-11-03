"use client";

import { useState } from "react";
import { api } from "@/client/api";
import type { Proposal } from "@/client/types";

/** ROSS's suggestions. Nothing changes until the user taps Approve. */
export function ProposalList({ proposals, onDecided }: { proposals: Proposal[]; onDecided: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!proposals.length) return null;

  async function decide(p: Proposal, approve: boolean) {
    setBusy(p.id);
    try {
      const r = await api<{ status: string; error?: string }>(`/api/coach/proposals/${p.id}`, { method: "POST", json: { approve } });
      setMsg((m) => ({ ...m, [p.id]: r.status === "applied" ? "Applied" : r.status === "rejected" ? "Dismissed" : `Couldn't apply: ${r.error ?? "unknown error"}` }));
      onDecided();
    } catch (e) {
      setMsg((m) => ({ ...m, [p.id]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-3">
      {proposals.map((p) => (
        <li key={p.id} className="rounded-2xl border border-lime/40 bg-panel p-3">
          <p className="font-bold">{p.title}</p>
          {p.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm text-muted">
              {p.details.map((d, i) => <li key={i} className="break-words">{d}</li>)}
            </ul>
          )}
          {p.rationale && <p className="mt-2 text-sm"><span className="font-semibold text-lime">Why: </span>{p.rationale}</p>}
          {p.status === "pending" && !msg[p.id] ? (
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy === p.id} onClick={() => void decide(p, true)} className="flex-1 rounded-xl bg-lime py-2.5 font-bold text-ink disabled:opacity-50">Approve</button>
              <button type="button" disabled={busy === p.id} onClick={() => void decide(p, false)} className="flex-1 rounded-xl border border-concrete py-2.5 font-semibold disabled:opacity-50">Not now</button>
            </div>
          ) : (
            <p className="mt-2 text-xs font-semibold text-muted">{msg[p.id] ?? (p.status === "applied" ? "Applied" : p.status === "rejected" ? "Dismissed" : p.error ? `Couldn't apply: ${p.error}` : p.status)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

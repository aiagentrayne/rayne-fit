"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";

interface MemoryItem {
  id: string;
  kind: "obstacle" | "strategy" | "preference" | "fact";
  text: string;
  status: "active" | "archived";
  editedByUser: boolean;
  updatedAt: string;
}

const KINDS: { value: MemoryItem["kind"]; label: string }[] = [
  { value: "obstacle", label: "Recurring obstacle" },
  { value: "strategy", label: "What works" },
  { value: "preference", label: "Preference" },
  { value: "fact", label: "Fact about me" },
];
const input = "w-full rounded-xl border border-concrete bg-ink px-3 py-2.5 text-base text-white placeholder:text-concrete";

/** Everything ROSS remembers between conversations, visible and correctable by the user. */
export default function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newKind, setNewKind] = useState<MemoryItem["kind"]>("fact");
  const [newText, setNewText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ memory: MemoryItem[] }>("/api/coach/memory")).memory);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function patch(id: string, body: Partial<MemoryItem>) {
    await api(`/api/coach/memory/${id}`, { method: "PATCH", json: body }).catch((e) => setError(e.message));
    setEditing(null);
    await load();
  }
  async function remove(id: string) {
    await api(`/api/coach/memory/${id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    await load();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api("/api/coach/memory", { method: "POST", json: { kind: newKind, text: newText } }).catch((err) => setError(err.message));
    setNewText("");
    await load();
  }

  const active = items?.filter((i) => i.status === "active") ?? [];
  const archived = items?.filter((i) => i.status === "archived") ?? [];
  return (
    <div className="space-y-5 pt-2">
      <Link href="/coach" className="text-sm text-muted underline">‹ Coach</Link>
      <h1 className="font-display text-3xl">What ROSS knows</h1>
      <p className="text-sm text-muted">
        ROSS keeps short notes between conversations so it doesn&apos;t ask the same things twice. Fix anything that&apos;s wrong, archive what&apos;s no longer true, or delete it.
        Your vision, milestones, measurables and interview summaries are on the <Link href="/coach" className="underline">Coach</Link> screen.
      </p>
      {error && <p role="alert" className="text-sm text-no">{error}</p>}
      {items === null ? (
        <p className="text-muted">Loading…</p>
      ) : active.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-concrete p-4 text-sm text-muted">Nothing yet. ROSS adds notes during interviews, and you can add your own below.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((m) => (
            <li key={m.id} className="rounded-xl bg-panel p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">{KINDS.find((k) => k.value === m.kind)?.label}{m.editedByUser ? " · edited by you" : ""}</p>
              {editing === m.id ? (
                <div className="mt-2 space-y-2">
                  <textarea className={input} rows={2} maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit note" />
                  <div className="flex gap-2 text-sm">
                    <button type="button" onClick={() => void patch(m.id, { text: draft })} className="rounded-lg bg-lime px-3 py-1.5 font-bold text-ink">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-concrete px-3 py-1.5">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-1">{m.text}</p>
                  <div className="mt-2 flex gap-3 text-xs font-semibold text-muted">
                    <button type="button" className="underline" onClick={() => { setEditing(m.id); setDraft(m.text); }}>Edit</button>
                    <button type="button" className="underline" onClick={() => void patch(m.id, { status: "archived" })}>No longer true</button>
                    <button type="button" className="text-no underline" onClick={() => void remove(m.id)}>Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="space-y-2 rounded-2xl bg-panel p-4">
        <p className="font-semibold">Tell ROSS something</p>
        <select className={input} value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryItem["kind"])} aria-label="Type">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <textarea className={input} rows={2} maxLength={500} required value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="I work 12-hour shifts on Tuesdays and Thursdays." aria-label="Note" />
        <button type="submit" className="w-full rounded-xl bg-lime py-2.5 font-bold text-ink">Add</button>
      </form>
      {archived.length > 0 && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">Archived ({archived.length})</summary>
          <ul className="mt-2 space-y-1">
            {archived.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>{m.text}</span>
                <span className="flex shrink-0 gap-2 text-xs">
                  <button type="button" className="underline" onClick={() => void patch(m.id, { status: "active" })}>Restore</button>
                  <button type="button" className="text-no underline" onClick={() => void remove(m.id)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

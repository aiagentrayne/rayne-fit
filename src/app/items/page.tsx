"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";
import { fmtTime } from "@/client/format";
import type { Item } from "@/client/types";
import { describeSchedule } from "@/lib/core/schedule";

export default function ItemsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Item[] }>("/api/items?all=1")).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function move(index: number, dir: -1 | 1) {
    if (!items) return;
    const visible = items.filter((i) => i.status !== "archived");
    const j = index + dir;
    if (j < 0 || j >= visible.length) return;
    const next = [...visible];
    [next[index], next[j]] = [next[j], next[index]];
    const archived = items.filter((i) => i.status === "archived");
    setItems([...next, ...archived]);
    await api("/api/items/reorder", { method: "POST", json: { ids: [...next, ...archived].map((i) => i.id) } }).catch((e) => setError(e.message));
  }

  async function setStatus(id: string, status: "active" | "inactive" | "archived") {
    await api(`/api/items/${id}`, { method: "PATCH", json: { status } }).catch((e) => setError(e.message));
    await load();
  }

  async function remove(item: Item) {
    if (!confirm(`Delete "${item.current.name}"? Past days keep their answers and grades.`)) return;
    await api(`/api/items/${item.id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    await load();
  }

  const visible = items?.filter((i) => i.status !== "archived") ?? [];
  const archived = items?.filter((i) => i.status === "archived") ?? [];

  return (
    <div className="space-y-5 pt-2">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Items</h1>
        <Link href="/items/new" className="rounded-xl bg-lime px-4 py-2 font-bold text-ink">
          + Add
        </Link>
      </header>
      <p className="text-sm text-muted">Each scheduled item is YES or NO for the day. Order here is the order on Today.</p>
      {error && <p role="alert" className="text-sm text-no">{error}</p>}
      {items === null ? (
        <p className="text-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-concrete p-6 text-center">
          <p className="font-semibold">No items yet</p>
          <p className="mt-1 text-sm text-muted">Add the things you commit to doing, like Exercise, Read 20 pages or No sugar.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((item, i) => (
            <li key={item.id} className={`rounded-2xl bg-panel p-3 ${item.status === "inactive" ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col">
                  <button className="h-9 w-9 rounded-lg border border-concrete disabled:opacity-30" disabled={i === 0} onClick={() => void move(i, -1)} aria-label={`Move ${item.current.name} up`}>
                    ↑
                  </button>
                  <button className="mt-1 h-9 w-9 rounded-lg border border-concrete disabled:opacity-30" disabled={i === visible.length - 1} onClick={() => void move(i, 1)} aria-label={`Move ${item.current.name} down`}>
                    ↓
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/items/${item.id}`} className="block">
                    <p className="truncate text-lg font-bold">{item.current.name}</p>
                    <p className="text-xs text-muted">
                      {describeSchedule(item.current.scheduleType, item.current.daysOfWeek)}
                      {item.current.dueTime && ` · due ${fmtTime(item.current.dueTime)}`}
                      {item.current.category && ` · ${item.current.category}`}
                    </p>
                    <p className="mt-1 text-xs">
                      {item.rules.enabled && (item.rules.reminderTimes.length || item.rules.nudgeOffsets.length || item.rules.deadlineWarningMinutes) ? (
                        <span className="text-lime">
                          ⏰ {item.rules.reminderTimes.map(fmtTime).join(", ") || "Due-time reminders"}
                          {item.rules.nudgeOffsets.length > 0 && ` · ${item.rules.nudgeOffsets.length} nudge${item.rules.nudgeOffsets.length > 1 ? "s" : ""}`}
                        </span>
                      ) : (
                        <span className="text-muted">No reminders</span>
                      )}
                      {item.status === "inactive" && <span className="ml-2 text-orange">Paused</span>}
                    </p>
                  </Link>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <Link href={`/items/${item.id}`} className="rounded-lg border border-concrete px-3 py-1.5">Edit</Link>
                {item.status === "active" ? (
                  <button className="rounded-lg border border-concrete px-3 py-1.5" onClick={() => void setStatus(item.id, "inactive")}>Pause</button>
                ) : (
                  <button className="rounded-lg border border-lime px-3 py-1.5 text-lime" onClick={() => void setStatus(item.id, "active")}>Resume</button>
                )}
                <button className="rounded-lg border border-concrete px-3 py-1.5" onClick={() => void setStatus(item.id, "archived")}>Archive</button>
                <button className="rounded-lg border border-no px-3 py-1.5 text-no" onClick={() => void remove(item)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section>
          <button className="text-sm font-semibold text-muted underline" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-3 space-y-2">
              {archived.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-xl bg-panel p-3 text-sm">
                  <span>{item.current.name}</span>
                  <button className="rounded-lg border border-lime px-3 py-1.5 text-xs font-semibold text-lime" onClick={() => void setStatus(item.id, "active")}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

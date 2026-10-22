"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { Item } from "@/client/types";
import { ItemForm } from "@/components/ItemForm";

export default function EditItemPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ item: Item }>(`/api/items/${id}`).then((r) => setItem(r.item), (e) => setError(e.message));
  }, [id]);
  return (
    <div className="space-y-5 pt-2">
      <h1 className="font-display text-3xl">Edit item</h1>
      {error ? <p className="text-no">{error}</p> : item ? <ItemForm item={item} /> : <p className="text-muted">Loading…</p>}
    </div>
  );
}

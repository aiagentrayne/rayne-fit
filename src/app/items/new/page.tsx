import { ItemForm } from "@/components/ItemForm";

export default function NewItemPage() {
  return (
    <div className="space-y-5 pt-2">
      <h1 className="font-display text-3xl">New item</h1>
      <ItemForm />
    </div>
  );
}

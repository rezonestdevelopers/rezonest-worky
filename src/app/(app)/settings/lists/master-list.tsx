"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { saveMasterItemAction } from "@/server/actions/catalogue";

type Item = { id: string; name: string; isActive: boolean };
type Kind = "sector" | "leadSource" | "department";

export function MasterList({ kind, title, items }: { kind: Kind; title: string; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");

  const save = (item: { id?: string; name: string; isActive: boolean }, after?: () => void) =>
    start(async () => {
      const res = await saveMasterItemAction({ kind, ...item });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        after?.();
        router.refresh();
      } else {
        toast.error(res.fieldErrors?.name ?? res.error);
      }
    });

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {items.map((item) => (
            <Row key={`${item.id}-${item.name}`} item={item} title={title} disabled={pending} onSave={(next) => save({ id: item.id, ...next })} />
          ))}
        </ul>
        <form
          className="flex items-center gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) save({ name: newName, isActive: true }, () => setNewName(""));
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add new…" aria-label={`Add to ${title}`} className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={pending || !newName.trim()}><Plus /> Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Row({ item, title, disabled, onSave }: { item: Item; title: string; disabled: boolean; onSave: (next: { name: string; isActive: boolean }) => void }) {
  const [name, setName] = useState(item.name);
  const changed = name.trim() !== item.name && name.trim().length > 0;
  return (
    <li className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && changed) {
            e.preventDefault();
            onSave({ name, isActive: item.isActive });
          }
        }}
        aria-label={`${title}: ${item.name}`}
        className={cn("h-8 min-w-0 flex-1", !item.isActive && "text-muted-foreground line-through")}
      />
      {changed && (
        <Button size="icon-sm" variant="outline" disabled={disabled} onClick={() => onSave({ name, isActive: item.isActive })} aria-label={`Save ${name}`}>
          <Check />
        </Button>
      )}
      <Switch checked={item.isActive} disabled={disabled} onCheckedChange={(isActive) => onSave({ name: item.name, isActive })} aria-label={`${item.name} is active`} />
    </li>
  );
}

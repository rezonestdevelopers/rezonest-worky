"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { ContactLinks } from "@/components/shared/contact-links";
import { applyFieldErrors, TextField } from "@/components/shared/form-fields";
import { contactSchema, type ContactInput } from "@/lib/validators/client";
import { archiveContactAction, saveContactAction } from "@/server/actions/clients";
import type { z } from "zod";

export type ContactRow = {
  id: string;
  name: string;
  designation: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  isPrimary: boolean;
};

const EMPTY: ContactInput = { name: "", designation: "", phone: "", whatsapp: "", email: "", isPrimary: false };

export function ContactsCard({ clientId, contacts, readOnly }: { clientId: string; contacts: ContactRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const form = useForm<ContactInput, unknown, z.output<typeof contactSchema>>({ resolver: zodResolver(contactSchema), defaultValues: EMPTY });

  const open = (c: ContactRow | null) => {
    form.reset(c ? { name: c.name, designation: c.designation ?? "", phone: c.phone ?? "", whatsapp: c.whatsapp ?? "", email: c.email ?? "", isPrimary: c.isPrimary } : EMPTY);
    setEditing({ id: c?.id ?? null });
  };

  const save = () =>
    start(async () => {
      const res = await saveContactAction(clientId, editing?.id ?? null, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        setEditing(null);
        router.refresh();
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact people</CardTitle>
        {!readOnly && <Button variant="outline" size="sm" onClick={() => open(null)}><Plus /> Add</Button>}
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {contacts.map((c) => (
            <li key={c.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {c.name} {c.isPrimary && <Badge tone="blue">Primary</Badge>}
                  </div>
                  <div className="text-xs break-words text-muted-foreground">
                    {[c.designation, c.phone, c.email].filter(Boolean).join(" · ") || "No details yet"}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => open(c)} aria-label={`Edit ${c.name}`}><Pencil /></Button>
                    {!c.isPrimary && (
                      <ConfirmButton
                        label=""
                        variant="ghost"
                        ariaLabel={`Remove ${c.name}`}
                        icon={<Trash2 />}
                        title={`Remove ${c.name}?`}
                        description="They'll no longer appear on this client. The record is kept in the history."
                        confirmLabel="Remove"
                        action={() => archiveContactAction(clientId, c.id)}
                      />
                    )}
                  </div>
                )}
              </div>
              <ContactLinks phone={c.phone} whatsapp={c.whatsapp} email={c.email} />
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit contact" : "Add contact"}</DialogTitle></DialogHeader>
          <form id="contact-form" onSubmit={form.handleSubmit(save)} className="grid gap-3" noValidate>
            <TextField form={form} name="name" label="Name" required />
            <TextField form={form} name="designation" label="Designation" />
            <TextField form={form} name="phone" label="Phone" inputMode="tel" />
            <TextField form={form} name="whatsapp" label="WhatsApp" inputMode="tel" />
            <TextField form={form} name="email" label="Email" type="email" />
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="isPrimary">Primary contact</Label>
              <Controller control={form.control} name="isPrimary" render={({ field }) => <Switch id="isPrimary" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="contact-form" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

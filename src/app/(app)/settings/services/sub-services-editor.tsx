"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NONE } from "@/components/shared/form-fields";
import { humanize } from "@/lib/status";
import { BILLING_TYPES, type SubServicesInput } from "@/lib/validators/catalogue";
import { saveSubServicesAction } from "@/server/actions/catalogue";

export function SubServicesEditor({ serviceId, items }: { serviceId: string; items: SubServicesInput["items"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<SubServicesInput>({ defaultValues: { serviceId, items } });
  const { fields, append } = useFieldArray({ control: form.control, name: "items", keyName: "key" });

  const save = () =>
    start(async () => {
      const res = await saveSubServicesAction(form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        form.reset(form.getValues());
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sub-services</CardTitle>
          <CardDescription>Blank price, billing or unit means the service&apos;s own value is used. Old offers use these, so they can be switched off but not deleted.</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", billingType: "", defaultPrice: "", unit: "", isActive: true })}><Plus /> Add</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <div className="space-y-3 sm:space-y-2">
          {fields.map((f, i) => (
            <div key={f.key} className="grid grid-cols-2 items-center gap-2 border-b pb-3 last:border-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_7rem_6rem_auto] sm:border-0 sm:pb-0">
              <Input className="col-span-2 sm:col-span-1" placeholder="Name" aria-label="Sub-service name" {...form.register(`items.${i}.name`)} />
              <Controller
                control={form.control}
                name={`items.${i}.billingType`}
                render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                    <SelectTrigger className="w-full" aria-label="Billing type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Same as service</SelectItem>
                      {BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{humanize(b)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              <Input placeholder="Price ₹" inputMode="decimal" aria-label="Price" {...form.register(`items.${i}.defaultPrice`)} />
              <Input placeholder="Unit" aria-label="Unit" {...form.register(`items.${i}.unit`)} />
              <Controller
                control={form.control}
                name={`items.${i}.isActive`}
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save sub-services
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

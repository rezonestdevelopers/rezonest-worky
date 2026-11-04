"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { applyFieldErrors, FieldNote, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { CONTENT_FORMATS, platformLabel, SOCIAL_PLATFORMS } from "@/lib/content-plan";
import { contentItemSchema, type ContentItemData, type ContentItemInput } from "@/lib/validators/delivery";
import { labelForFormat } from "@/lib/work-plan";
import { saveContentItemAction } from "@/server/actions/delivery";

export function ContentForm({ id, defaults, clients, projects }: { id: string | null; defaults: ContentItemInput; clients: { value: string; label: string }[]; projects: { value: string; label: string; clientId: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<ContentItemInput, unknown, ContentItemData>({ resolver: zodResolver(contentItemSchema), defaultValues: defaults });
  const clientId = useWatch({ control: form.control, name: "clientId" });
  const platformsError = form.formState.errors.platforms?.message;

  const save = () =>
    start(async () => {
      const res = await saveContentItemAction(id, form.getValues());
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.push(`/content/${res.id}`);
        router.refresh();
      } else {
        toast.error(res.error);
        applyFieldErrors(form, res);
      }
    });

  return (
    <form onSubmit={form.handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} className="space-y-4" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField form={form} name="clientId" label="Client" required options={clients} noneLabel="Choose a client" />
          <SelectField form={form} name="projectId" label="Project" options={projects.filter((p) => p.clientId === clientId)} noneLabel="No project" />
          <TextField form={form} name="topic" label="Topic" required className="sm:col-span-2" />
          <SelectField form={form} name="format" label="Format" required options={CONTENT_FORMATS.map((f) => ({ value: f, label: labelForFormat(f) }))} />
          <TextField form={form} name="publishDate" label="Publish date" type="date" required />
          <fieldset className="space-y-1.5 sm:col-span-2">
            <legend className="text-sm font-medium">Platforms<span className="text-tone-red" aria-hidden>*</span></legend>
            <Controller
              control={form.control}
              name="platforms"
              render={({ field }) => (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {SOCIAL_PLATFORMS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.value.includes(p)}
                        onChange={(e) => field.onChange(e.target.checked ? [...field.value, p] : field.value.filter((x) => x !== p))}
                      />
                      {platformLabel(p)}
                    </label>
                  ))}
                </div>
              )}
            />
            <FieldNote error={platformsError} />
          </fieldset>
          <TextAreaField form={form} name="caption" label="Caption" rows={5} className="sm:col-span-2" hint="The client sees this on their approval page." />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild><Link href={id ? `/content/${id}` : "/content"}>Cancel</Link></Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id ? "Save" : "Add content"}</Button>
      </div>
    </form>
  );
}

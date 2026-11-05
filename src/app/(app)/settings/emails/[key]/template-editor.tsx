"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FieldNote } from "@/components/shared/form-fields";
import { renderTemplate, unknownPlaceholders } from "@/lib/email-templates";
import { resetTemplateAction, saveTemplateAction, sendTestTemplateAction } from "@/server/actions/email-templates";

export function TemplateEditor({ templateKey, subject, body, whatsapp, hasWhatsapp, placeholders }: { templateKey: string; subject: string; body: string; whatsapp: string | null; hasWhatsapp: boolean; placeholders: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ subject, body, whatsapp: whatsapp ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [synced, setSynced] = useState(`${subject}|${body}|${whatsapp}`);

  // After Reset the page sends new text, which replaces what's in the boxes.
  const incoming = `${subject}|${body}|${whatsapp}`;
  if (incoming !== synced) {
    setSynced(incoming);
    setForm({ subject, body, whatsapp: whatsapp ?? "" });
  }

  const preview = renderTemplate(form, placeholders);
  const unknown = unknownPlaceholders(templateKey, [form.subject, form.body, form.whatsapp].join("\n"));
  const dirty = form.subject !== subject || form.body !== body || form.whatsapp !== (whatsapp ?? "");

  const save = () =>
    start(async () => {
      setErrors({});
      const res = await saveTemplateAction({ key: templateKey, ...form });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.refresh();
      } else {
        toast.error(res.error);
        setErrors(res.fieldErrors ?? {});
      }
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" aria-invalid={!!errors.subject} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
              <FieldNote error={errors.subject} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea id="body" rows={12} aria-invalid={!!errors.body} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
              <FieldNote error={errors.body} />
            </div>
            {hasWhatsapp && (
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp">WhatsApp message</Label>
                <Textarea id="whatsapp" rows={4} value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} />
              </div>
            )}
            {unknown.length > 0 && <FieldNote error={`These can't be filled in: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Check the spelling against the list.`} />}
            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <ConfirmButton label="Reset" icon={<RotateCcw />} title="Go back to the original text?" description="Your edits to this template will be replaced." confirmLabel="Reset" action={resetTemplateAction.bind(null, templateKey)} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || dirty}
                  title={dirty ? "Save first" : undefined}
                  onClick={() =>
                    start(async () => {
                      const res = await sendTestTemplateAction(templateKey);
                      if (res.ok) toast.success(res.message ?? "Sent");
                      else toast.error(res.error);
                    })
                  }
                >
                  <Send /> Send me a test
                </Button>
              </div>
              <Button size="sm" disabled={pending || !dirty || unknown.length > 0} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What you can use</CardTitle>
              <CardDescription>Type these exactly, and they&apos;re filled in when the message goes out.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-1.5">
              {Object.keys(placeholders).map((p) => <li key={p}><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{${p}}}`}</code></li>)}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0 self-start">
        <CardHeader>
          <div>
            <CardTitle>Preview</CardTitle>
            <CardDescription>With example details.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="font-medium break-words" data-testid="preview-subject">{preview.subject}</p>
          <p className="break-words whitespace-pre-wrap" data-testid="preview-body">{preview.text}</p>
          {hasWhatsapp && preview.whatsapp && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">WhatsApp</p>
              <p className="break-words whitespace-pre-wrap">{preview.whatsapp}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

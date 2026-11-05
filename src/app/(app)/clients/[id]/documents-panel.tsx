"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Download, Eye, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FieldNote } from "@/components/shared/form-fields";
import { canPreview, DOCUMENT_CATEGORIES, documentCategoryLabel, formatFileSize, isFinanceDocument } from "@/lib/file-types";
import { archiveDocumentAction, uploadClientDocumentAction } from "@/server/actions/expenses";

export type DocumentRow = { id: string; name: string; category: string; created: string; sizeBytes: number; mimeType: string; removable: boolean };

export function DocumentsPanel({ clientId, rows, showMoney }: { clientId: string; rows: DocumentRow[]; showMoney: boolean }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("AGREEMENT");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const options = DOCUMENT_CATEGORIES.filter((c) => showMoney || !isFinanceDocument(c));

  const upload = () =>
    start(async () => {
      setError(undefined);
      const chosen = file.current?.files?.[0];
      if (!chosen) {
        setError("Please choose a file.");
        return;
      }
      const data = new FormData();
      data.set("clientId", clientId);
      data.set("category", category);
      data.set("file", chosen);
      const res = await uploadClientDocumentAction(data);
      if (res.ok) {
        toast.success(res.message ?? "Added");
        if (file.current) file.current.value = "";
        router.refresh();
      } else setError(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Agreements, NDAs, brand assets, briefs and reports. Images, PDF, Word, Excel or PowerPoint, up to 20 MB.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="docCategory">Kind</Label>
            <select id="docCategory" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              {options.map((c) => <option key={c} value={c}>{documentCategoryLabel(c)}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="docFile">File</Label>
            <input id="docFile" ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx" className="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm" />
          </div>
          <Button disabled={pending} onClick={upload}>{pending ? <Loader2 className="animate-spin" /> : <Upload />} Upload</Button>
          <div className="sm:col-span-3"><FieldNote error={error} /></div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <ul className="divide-y" data-testid="document-list">
            {rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="truncate font-medium" title={d.name}>{d.name}</div>
                  <div className="text-xs text-muted-foreground">{documentCategoryLabel(d.category)} · {d.created} · {formatFileSize(d.sizeBytes)}</div>
                </div>
                <div className="flex items-center gap-1">
                  {canPreview(d.mimeType) && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/api/documents/${d.id}?view=1`} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${d.name}`}><Eye /> Preview</a>
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api/documents/${d.id}`} aria-label={`Download ${d.name}`}><Download /> Download</a>
                  </Button>
                  {d.removable && <ConfirmButton variant="ghost" label="Archive" icon={<Archive />} ariaLabel={`Archive ${d.name}`} title="Archive this document?" description="It's hidden from this list. The file is kept, and nothing is permanently deleted." confirmLabel="Archive" action={() => archiveDocumentAction(d.id, clientId)} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

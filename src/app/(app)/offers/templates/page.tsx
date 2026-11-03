import type { Metadata } from "next";
import Link from "next/link";
import { Archive, FilePlus2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { formatINR } from "@/lib/money/format";
import { setOfferArchivedAction } from "@/server/actions/offers";
import { getTemplates } from "@/server/queries/offers";

export const metadata: Metadata = { title: "Offer templates" };

export default async function TemplatesPage() {
  await requirePermission("sales.manage");
  const templates = await getTemplates();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="Offer templates"
        description="Ready-made packages. They don't use up a quotation number."
        back={{ href: "/offers", label: "Offers" }}
        actions={<Button size="sm" asChild><Link href="/offers/templates/new"><Plus /> New template</Link></Button>}
      />
      {templates.length === 0 ? (
        <div className="glass rounded-xl border"><EmptyState title="No templates yet" hint="Create one here, or use “Save as template” on any offer." className="py-14" /></div>
      ) : (
        <div className="glass overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Template</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Value excl. GST</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell><Link href={`/offers/templates/${t.id}`} className="font-medium hover:underline">{t.templateName ?? t.title}</Link></TableCell>
                  <TableCell className="tabular-nums">{t._count.items}</TableCell>
                  <TableCell className="tabular-nums">{formatINR(t.taxableTotal, { decimals: false })}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" asChild><Link href={`/offers/new?template=${t.id}`}><FilePlus2 /> Use</Link></Button>
                      <ConfirmButton
                        label=""
                        ariaLabel={`Archive ${t.templateName ?? t.title}`}
                        variant="ghost"
                        icon={<Archive />}
                        title="Archive this template?"
                        description="It won't be offered for new quotations. Offers made from it aren't affected."
                        confirmLabel="Archive"
                        action={setOfferArchivedAction.bind(null, t.id, true)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

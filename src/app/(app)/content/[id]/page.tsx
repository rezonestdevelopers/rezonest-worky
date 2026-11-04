import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirePermission } from "@/lib/auth-guard";
import { platformLabel } from "@/lib/content-plan";
import { formatDateKey, formatDateTime, formatMonthKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { safeExternalUrl } from "@/lib/safe-url";
import { statusDef } from "@/lib/status";
import { labelForFormat } from "@/lib/work-plan";
import { setContentArchivedAction } from "@/server/actions/delivery";
import { getContentItem } from "@/server/queries/content";
import { loadViewer } from "@/server/services/tasks";
import { ApprovalPanel, CreativePanel, DesignPanel, PublishPanel } from "./content-panels";

export const metadata: Metadata = { title: "Content item" };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children || "—"}</dd>
  </div>
);

export default async function ContentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("work.own");
  const { id } = await params;
  const canManage = can(user.role, "work.manage");
  const item = await getContentItem(id, await loadViewer(db, user));
  if (!item) notFound();
  const archived = !!item.archivedAt;
  const published = !!item.publishedAt;
  const link = safeExternalUrl(item.publishedLink);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={item.topic}
        back={{ href: `/content?month=${item.month}&client=${item.clientId}`, label: "Content Calendar" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {published ? <Badge tone="blue">Published</Badge> : <StatusBadge kind="approval" value={item.approvalStatus} />}
            <StatusBadge kind="design" value={item.designStatus} />
            <span>{item.client.companyName}</span>
          </span>
        }
        actions={
          canManage &&
          (archived ? (
            <ConfirmButton label="Restore" icon={<ArchiveRestore />} title="Restore this item?" description="It comes back to the calendar." confirmLabel="Restore" action={setContentArchivedAction.bind(null, id, false)} />
          ) : (
            <>
              {!published && <Button variant="outline" size="sm" asChild><Link href={`/content/${id}/edit`}><Pencil /> Edit</Link></Button>}
              {!item.deliverableId && <ConfirmButton label="Archive" icon={<Archive />} title="Archive this item?" description="It leaves the calendar and the client's page. Nothing is deleted." confirmLabel="Archive" action={setContentArchivedAction.bind(null, id, true)} />}
            </>
          ))
        }
      />
      {archived && <div role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">Archived on {formatDateTime(item.archivedAt)}.</div>}
      {!item.platforms.length && !published && !archived && (
        <div role="status" className="rounded-lg border border-tone-amber/30 bg-tone-amber/10 px-3 py-2 text-sm">
          This came from the monthly package. Give it a real topic, platforms and caption before the client sees it.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader><CardTitle>Caption</CardTitle></CardHeader>
            <CardContent><p className="text-sm break-words whitespace-pre-wrap">{item.caption || <span className="text-muted-foreground">No caption yet.</span>}</p></CardContent>
          </Card>
          <CreativePanel
            itemId={id}
            readOnly={archived || published}
            url={item.creativeUrl ?? ""}
            openUrl={safeExternalUrl(item.creativeUrl)}
            image={item.creative?.mimeType.startsWith("image/") ? `/api/content/${id}/creative` : null}
            file={item.creative && !item.creative.mimeType.startsWith("image/") ? { href: `/api/content/${id}/creative`, name: item.creative.name } : null}
          />
          <Card>
            <CardHeader><CardTitle>What the client said</CardTitle></CardHeader>
            <CardContent>
              {item.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ol className="space-y-3">
                  {item.approvals.map((a) => (
                    <li key={a.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {a.byName}
                        <Badge tone={statusDef("approval", a.decision).tone}>{statusDef("approval", a.decision).label}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(a.createdAt)}{a.publicLinkId ? ", through the link" : ""}{canManage && a.ip ? ` · IP ${a.ip}` : ""}
                      </div>
                      {a.comment && <p className="mt-1 break-words whitespace-pre-wrap">{a.comment}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent>
              <dl className="divide-y">
                <Row label="Client">{canManage ? <Link href={`/clients/${item.client.id}?tab=content`} className="underline">{item.client.companyName}</Link> : item.client.companyName}</Row>
                <Row label="Project">{item.project && <Link href={`/projects/${item.project.id}`} className="underline">{item.project.name}</Link>}</Row>
                <Row label="Publish date">{formatDateKey(item.publishDate)}</Row>
                <Row label="Month">{formatMonthKey(item.month)}</Row>
                <Row label="Format">{labelForFormat(item.format)}</Row>
                <Row label="Platforms">{item.platforms.map(platformLabel).join(", ")}</Row>
                {item.deliverable && <Row label="Revisions">{item.deliverable.revisionsUsed} of {item.deliverable.revisionsIncluded} included</Row>}
              </dl>
            </CardContent>
          </Card>
          {!archived && <DesignPanel itemId={id} status={item.designStatus} readOnly={published} />}
          {!archived && canManage && !published && <ApprovalPanel itemId={id} status={item.approvalStatus} />}
          {!archived && (
            <PublishPanel
              itemId={id}
              canUndo={canManage}
              published={published ? { at: formatDateTime(item.publishedAt), link } : null}
              approved={item.approvalStatus === "APPROVED"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

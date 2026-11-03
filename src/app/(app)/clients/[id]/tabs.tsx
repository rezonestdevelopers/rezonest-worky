import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { dateOnlyKey, formatDateKey, formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { sum } from "@/lib/money/decimal";
import { effectiveHealth } from "@/lib/health";
import { humanize } from "@/lib/status";
import { clientTabQueries } from "@/server/queries/clients";

/**
 * Tabs that show what's already recorded for a client. Adding and editing these
 * records arrives with each section's own phase, which is what `phase` tells the user.
 */
function TabTable({
  columns,
  rows,
  empty,
  phase,
  section,
}: {
  columns: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  empty: string;
  phase: number;
  section: string;
}) {
  return (
    <Card className="gap-3">
      <CardContent className="space-y-3 px-0 sm:px-5">
        {rows.length === 0 ? (
          <EmptyState title={empty} hint={`Adding ${section} from here arrives in Phase ${phase}.`} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    {r.cells.map((cell, i) => <TableCell key={i}>{cell}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="px-5 text-xs text-muted-foreground sm:px-0">
              Showing the latest {rows.length}. Managing {section} here arrives in Phase {phase}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const amount = (v: Parameters<typeof formatINR>[0]) => <span className="tabular-nums">{formatINR(v)}</span>;
const clip = (text: string, width = "max-w-72") => <span className={`block truncate ${width}`} title={text}>{text}</span>;

/** Turns stored changes into a readable line, e.g. "status: ACTIVE → ARCHIVED". */
function describeChanges(changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  return Object.entries(changes as Record<string, unknown>)
    .map(([field, value]) => {
      if (value && typeof value === "object" && "to" in value) {
        const { from, to } = value as { from: unknown; to: unknown };
        return `${field}: ${from ?? "—"} → ${to ?? "—"}`;
      }
      return `${field}: ${String(value)}`;
    })
    .join("; ");
}

export async function ClientTab({ tab, clientId }: { tab: string; clientId: string }) {
  switch (tab) {
    case "offers": {
      const rows = await clientTabQueries.offers(clientId);
      return (
        <TabTable
          section="offers" phase={3} empty="No offers yet"
          columns={["Number", "Title", "Status", "Date", "Valid until", "Value (excl. GST)"]}
          rows={rows.map((o) => ({
            key: o.id,
            cells: [<Link key="n" href={`/offers/${o.id}`} className="font-medium hover:underline">{o.number}</Link>, clip(o.title), <StatusBadge key="s" kind="offer" value={o.status} />, formatDateKey(o.offerDate), formatDateKey(o.validUntil), amount(o.taxableTotal)],
          }))}
        />
      );
    }
    case "projects": {
      const rows = await clientTabQueries.projects(clientId);
      return (
        <TabTable
          section="projects" phase={4} empty="No projects yet"
          columns={["Code", "Project", "Status", "Health", "Progress", "Start", "Deadline / ends", "Manager"]}
          rows={rows.map((p) => ({
            key: p.id,
            cells: [
              p.code, clip(p.name), <StatusBadge key="s" kind="project" value={p.status} />,
              <StatusBadge key="h" kind="health" value={effectiveHealth(p.healthAuto, p.healthOverride)} />,
              `${p.progressPercent}%`, formatDateKey(p.startDate), formatDateKey(p.deadline ?? p.retainerEnd), p.manager?.name ?? "—",
            ],
          }))}
        />
      );
    }
    case "tasks": {
      const rows = await clientTabQueries.tasks(clientId);
      return (
        <TabTable
          section="tasks" phase={4} empty="No open tasks"
          columns={["Task", "Status", "Priority", "Due", "Assigned to"]}
          rows={rows.map((t) => ({
            key: t.id,
            cells: [clip(t.title), <StatusBadge key="s" kind="task" value={t.status} />, <StatusBadge key="p" kind="priority" value={t.priority} />, formatDateKey(t.dueDate), t.assignee?.name ?? "—"],
          }))}
        />
      );
    }
    case "content": {
      const rows = await clientTabQueries.content(clientId);
      return (
        <TabTable
          section="the content calendar" phase={5} empty="No content planned"
          columns={["Topic", "Format", "Platforms", "Design", "Approval", "Publish date"]}
          rows={rows.map((c) => ({
            key: c.id,
            cells: [clip(c.topic), humanize(c.format), c.platforms.map(humanize).join(", "), humanize(c.designStatus), humanize(c.approvalStatus), formatDateKey(c.publishDate)],
          }))}
        />
      );
    }
    case "ads": {
      const rows = await clientTabQueries.ads(clientId);
      return (
        <TabTable
          section="ad campaigns" phase={5} empty="No ad campaigns"
          columns={["Campaign", "Objective", "Status", "Start", "End", "Client's budget", "Spent", "Leads"]}
          rows={rows.map((c) => ({
            key: c.id,
            cells: [
              clip(c.name), c.objective ?? "—", humanize(c.status), formatDateKey(c.startDate), formatDateKey(c.endDate), amount(c.plannedBudget),
              amount(sum(c.entries.map((e) => e.spend))), c.entries.reduce((n, e) => n + e.leads, 0),
            ],
          }))}
        />
      );
    }
    case "renewals": {
      const rows = await clientTabQueries.renewals(clientId);
      return (
        <TabTable
          section="renewals" phase={5} empty="No domains or hosting"
          columns={["Item", "Type", "Provider", "Expires", "Auto-renew", "Credentials kept in"]}
          rows={rows.map((a) => ({
            key: a.id,
            cells: [clip(a.name), humanize(a.kind), a.provider ?? "—", formatDateKey(dateOnlyKey(a.expiryDate)), a.autoRenew ? "Yes" : "No", clip(a.credentialsLocation ?? "—", "max-w-56")],
          }))}
        />
      );
    }
    case "invoices": {
      const rows = await clientTabQueries.invoices(clientId);
      return (
        <TabTable
          section="invoices" phase={7} empty="No invoices yet"
          columns={["Number", "Type", "Status", "Payment", "Date", "Due", "Total", "Balance"]}
          rows={rows.map((i) => ({
            key: i.id,
            cells: [
              i.number ?? "Draft", humanize(i.type), <StatusBadge key="s" kind="invoice" value={i.status} />,
              i.status === "ISSUED" ? <StatusBadge key="p" kind="payment" value={i.paymentStatus} /> : "—",
              formatDateKey(i.invoiceDate), formatDateKey(i.dueDate), amount(i.grandTotal), amount(i.balanceDue),
            ],
          }))}
        />
      );
    }
    case "payments": {
      const rows = await clientTabQueries.payments(clientId);
      return (
        <TabTable
          section="payments" phase={7} empty="No payments yet"
          columns={["Date", "Amount received", "TDS", "Mode", "Reference"]}
          rows={rows.map((p) => ({ key: p.id, cells: [formatDateKey(p.date), amount(p.amount), amount(p.tdsAmount), humanize(p.mode), p.reference ?? "—"] }))}
        />
      );
    }
    case "expenses": {
      const rows = await clientTabQueries.expenses(clientId);
      return (
        <TabTable
          section="expenses" phase={8} empty="No expenses linked"
          columns={["Date", "Category", "Description", "Vendor", "Amount"]}
          rows={rows.map((e) => ({ key: e.id, cells: [formatDateKey(e.date), humanize(e.category), clip(e.description), e.vendor ?? "—", amount(e.amount)] }))}
        />
      );
    }
    case "documents": {
      const rows = await clientTabQueries.documents(clientId);
      return (
        <TabTable
          section="documents" phase={8} empty="No documents yet"
          columns={["Name", "Category", "Uploaded", "Size"]}
          rows={rows.map((d) => ({ key: d.id, cells: [clip(d.name), humanize(d.category), formatDateTime(d.createdAt), `${Math.ceil(d.sizeBytes / 1024)} KB`] }))}
        />
      );
    }
    case "communication": {
      const rows = await clientTabQueries.communication(clientId);
      return (
        <TabTable
          section="the communication log" phase={8} empty="No communication logged"
          columns={["Date", "Type", "Summary", "Next action", "Next action date"]}
          rows={rows.map((c) => ({ key: c.id, cells: [formatDateTime(c.date), humanize(c.type), clip(c.summary, "max-w-96"), c.nextAction ? clip(c.nextAction) : "—", formatDateKey(c.nextActionDate)] }))}
        />
      );
    }
    case "reports":
      return (
        <Card>
          <CardContent>
            <EmptyState title="Client reports arrive in Phase 9" hint="You'll be able to download internal and client-facing reports (PDF and Excel) from here." />
          </CardContent>
        </Card>
      );
    case "activity": {
      const rows = await clientTabQueries.activity(clientId);
      return (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState title="No activity recorded yet" />
            ) : (
              <ol className="divide-y">
                {rows.map((a) => {
                  const detail = describeChanges(a.changes);
                  return (
                    <li key={a.id} className="py-2.5 text-sm">
                      <div className="font-medium">{humanize(a.action.replace(/[.]/g, "_"))}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)} · {a.actor?.name ?? "System"}</div>
                      {detail && <div className="mt-0.5 text-xs break-words text-muted-foreground">{detail}</div>}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      );
    }
    default:
      return (
        <Card>
          <CardContent>
            <Link href="?tab=overview" className="text-sm underline">Back to overview</Link>
          </CardContent>
        </Card>
      );
  }
}

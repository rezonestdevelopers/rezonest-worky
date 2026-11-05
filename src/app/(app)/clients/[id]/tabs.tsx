import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { dateOnlyKey, formatDateKey, formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { sum } from "@/lib/money/decimal";
import { effectiveHealth } from "@/lib/health";
import { paymentModeLabel } from "@/lib/invoice-rules";
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
  phase?: number;
  section: string;
}) {
  return (
    <Card className="gap-3">
      <CardContent className="space-y-3 px-0 sm:px-5">
        {rows.length === 0 ? (
          <EmptyState title={empty} hint={phase ? `Adding ${section} from here arrives in Phase ${phase}.` : undefined} />
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
              Showing the latest {rows.length}.{phase ? ` Managing ${section} here arrives in Phase ${phase}.` : ""}
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

export async function ClientTab({ tab, clientId, showMoney }: { tab: string; clientId: string; showMoney: boolean }) {
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
          section="projects" empty="No projects yet"
          columns={["Code", "Project", "Status", "Health", "Progress", "Start", "Deadline / ends", "Manager"]}
          rows={rows.map((p) => ({
            key: p.id,
            cells: [
              p.code, <Link key="n" href={`/projects/${p.id}`} className="block max-w-72 truncate font-medium hover:underline">{p.name}</Link>, <StatusBadge key="s" kind="project" value={p.status} />,
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
          section="tasks" empty="No open tasks"
          columns={["Task", "Status", "Priority", "Due", "Assigned to"]}
          rows={rows.map((t) => ({
            key: t.id,
            cells: [<Link key="n" href={`/tasks/${t.id}`} className="block max-w-72 truncate font-medium hover:underline">{t.title}</Link>, <StatusBadge key="s" kind="task" value={t.status} />, <StatusBadge key="p" kind="priority" value={t.priority} />, formatDateKey(t.dueDate), t.assignee?.name ?? "—"],
          }))}
        />
      );
    }
    case "content": {
      const rows = await clientTabQueries.content(clientId);
      return (
        <TabTable
          section="the content calendar" empty="No content planned"
          columns={["Topic", "Format", "Platforms", "Design", "Approval", "Publish date"]}
          rows={rows.map((c) => ({
            key: c.id,
            cells: [<Link key="n" href={`/content/${c.id}`} className="block max-w-72 truncate font-medium hover:underline">{c.topic}</Link>, humanize(c.format), c.platforms.map(humanize).join(", ") || "—", <StatusBadge key="d" kind="design" value={c.designStatus} />, <StatusBadge key="a" kind="approval" value={c.approvalStatus} />, formatDateKey(c.publishDate)],
          }))}
        />
      );
    }
    case "ads": {
      const rows = await clientTabQueries.ads(clientId);
      return (
        <TabTable
          section="ad campaigns" empty="No ad campaigns"
          columns={["Campaign", "Objective", "Status", "Start", "End", "Client's budget", "Spent", "Leads"]}
          rows={rows.map((c) => ({
            key: c.id,
            cells: [
              <Link key="n" href={`/ads/${c.id}`} className="block max-w-72 truncate font-medium hover:underline">{c.name}</Link>, c.objective ?? "—", <StatusBadge key="s" kind="campaign" value={c.status} />, formatDateKey(c.startDate), formatDateKey(c.endDate), amount(c.plannedBudget),
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
          section="renewals" empty="No domains or hosting"
          columns={["Item", "Type", "Provider", "Expires", "Auto-renew", "Credentials kept in"]}
          rows={rows.map((a) => ({
            key: a.id,
            cells: [showMoney ? <Link key="n" href={`/renewals/${a.id}`} className="block max-w-72 truncate font-medium hover:underline">{a.name}</Link> : clip(a.name), humanize(a.kind), a.provider ?? "—", formatDateKey(dateOnlyKey(a.expiryDate)), a.autoRenew ? "Yes" : "No", clip(a.credentialsLocation ?? "—", "max-w-56")],
          }))}
        />
      );
    }
    case "invoices": {
      const rows = await clientTabQueries.invoices(clientId);
      return (
        <div className="space-y-3">
        <div className="flex flex-wrap justify-end gap-4">
          <Link href={`/clients/${clientId}/statement`} className="text-sm font-medium underline-offset-4 hover:underline">Statement of account</Link>
          <Link href={`/invoices/new?client=${clientId}`} className="text-sm font-medium underline-offset-4 hover:underline">New invoice</Link>
        </div>
        <TabTable
          section="invoices" empty="No invoices yet"
          columns={["Number", "Type", "Status", "Payment", "Date", "Due", "Total", "Balance"]}
          rows={rows.map((i) => ({
            key: i.id,
            cells: [
              <Link key="n" href={`/invoices/${i.id}`} className="font-medium whitespace-nowrap hover:underline">{i.number ?? "Draft"}</Link>, humanize(i.type), <StatusBadge key="s" kind="invoice" value={i.status} />,
              i.status === "ISSUED" ? <StatusBadge key="p" kind="payment" value={i.paymentStatus} /> : "—",
              formatDateKey(i.invoiceDate), formatDateKey(i.dueDate), amount(i.grandTotal), amount(i.balanceDue),
            ],
          }))}
        />
        </div>
      );
    }
    case "payments": {
      const rows = await clientTabQueries.payments(clientId);
      return (
        <div className="space-y-3">
        <div className="flex justify-end">
          <Link href={`/payments/new?client=${clientId}`} className="text-sm font-medium underline-offset-4 hover:underline">Record a payment</Link>
        </div>
        <TabTable
          section="payments" empty="No payments yet"
          columns={["Date", "Amount received", "TDS", "Mode", "Reference"]}
          rows={rows.map((p) => ({ key: p.id, cells: [<Link key="d" href={`/payments/${p.id}`} className="font-medium whitespace-nowrap hover:underline">{formatDateKey(p.date)}</Link>, amount(p.amount), amount(p.tdsAmount), paymentModeLabel(p.mode), p.reference ?? "—"] }))}
        />
        </div>
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

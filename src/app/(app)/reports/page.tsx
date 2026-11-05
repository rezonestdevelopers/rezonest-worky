import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, CalendarRange, FileSpreadsheet, UserRound, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Reports" };

const REPORTS: { href: string; icon: LucideIcon; title: string; text: string; finance?: boolean }[] = [
  { href: "/reports/agency", icon: BarChart3, title: "Agency report", text: "Revenue by month, service, sector and source, conversion, MRR, ageing, team on-time, renewals and profit.", finance: true },
  { href: "/reports/gst", icon: FileSpreadsheet, title: "GST summary", text: "Output tax by month for your CA, with every tax invoice and credit note.", finance: true },
  { href: "/reports/client", icon: UserRound, title: "Client report (internal)", text: "Everything about one client, including prices, costs and profit. Not for sending.", finance: true },
  { href: "/reports/monthly", icon: CalendarRange, title: "Monthly report for a client", text: "Branded, with no prices, costs or team names. Add highlights and next month's plan, then email it." },
];

export default async function ReportsPage() {
  const user = await requirePermission("reports.monthly");
  const reports = REPORTS.filter((r) => !r.finance || can(user.role, "finance.manage"));
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="Each one opens on screen, and downloads as PDF and Excel." />
      <div className="grid gap-3 sm:grid-cols-2">
        {reports.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="h-full transition-colors hover:bg-accent/40">
              <CardContent className="flex gap-3">
                <r.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">{r.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{r.text}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

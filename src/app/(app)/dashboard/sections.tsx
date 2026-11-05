import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CalendarClock, CheckCircle2, Clock, Globe, IndianRupee, MessageSquareReply, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { BarList } from "@/components/dashboard/bar-list";
import { SectionCard } from "@/components/dashboard/section-card";
import { LeadSourceChart, RevenueTrendChart, ServiceRevenueChart, StackedPeopleChart } from "@/components/dashboard/charts";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { ClientWorkTable } from "@/components/dashboard/client-work-table";
import { Deadlines } from "@/components/dashboard/deadlines";
import { formatINR, formatINRCompact, formatPercent } from "@/lib/money/format";
import { formatDateKey, formatMonthKey } from "@/lib/dates";
import { statusDef } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Scope } from "@/server/queries/dashboard/filters";
import { getCharts, getClientWork, getDeadlines, getKpis, getPipeline, getTodayStrip, type Kpi } from "@/server/queries/dashboard/data";
import { ALERT_CATEGORIES, getAlerts } from "@/server/queries/dashboard/alerts";
import { getSettings } from "@/lib/settings";

type Perms = { money: boolean; profit: boolean };
const inr0 = (v: number) => formatINR(v, { decimals: false });

// ─── Today strip ─────────────────────────────────────────────────────────────
export async function TodayStrip({ scope, perms }: { scope: Scope; perms: Perms }) {
  const t = await getTodayStrip(scope);
  const items = [
    { label: "Tasks due today", value: t.dueToday, icon: Clock, href: "?alerts=due_today#alerts", tone: "text-tone-blue" },
    { label: "Approvals pending", value: t.approvals, icon: CheckCircle2, href: "?alerts=approval#alerts", tone: "text-tone-violet" },
    { label: "Follow-ups due", value: t.followUps, icon: MessageSquareReply, href: "?alerts=follow_up#alerts", tone: "text-tone-amber" },
    ...(perms.money
      ? [{ label: "Payments due", value: t.paymentsDue.count, sub: t.paymentsDue.amount ? formatINRCompact(t.paymentsDue.amount) : undefined, icon: IndianRupee, href: "?alerts=payment#alerts", tone: "text-tone-red" }]
      : []),
    { label: "Renewals this week", value: t.renewals, icon: Globe, href: "?alerts=renewal#alerts", tone: "text-tone-amber" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <div className="glass col-span-2 flex items-center gap-3 rounded-xl border px-4 py-3 sm:col-span-3 lg:col-span-1">
        <CalendarClock className="size-5 text-primary" />
        <div>
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Today</div>
          <div className="text-sm font-semibold">{formatDateKey(scope.today)}</div>
        </div>
      </div>
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          scroll={false}
          className="glass group flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-accent/60"
        >
          <i.icon className={cn("size-5 shrink-0", i.tone)} />
          <div className="min-w-0">
            <div className="text-lg leading-tight font-semibold tabular-nums">
              {i.value}
              {"sub" in i && i.sub && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{i.sub}</span>}
            </div>
            <div className="truncate text-xs text-muted-foreground group-hover:text-foreground">{i.label}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── KPI cards ───────────────────────────────────────────────────────────────
export async function KpiCards({ scope, perms }: { scope: Scope; perms: Perms }) {
  const kpis = (await getKpis(scope)).filter((k) => perms.money || !k.money);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
        <KpiCard key={k.key} kpi={k} compareLabel={scope.f.compareLabel} />
      ))}
    </div>
  );
}

function KpiCard({ kpi, compareLabel }: { kpi: Kpi; compareLabel: string }) {
  const d = kpi.delta;
  const good = d === null || d === 0 ? null : kpi.goodWhenUp ? d > 0 : d < 0;
  const Icon = d === null || Math.abs(d) < 0.5 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="gap-2 py-4">
      <CardContent className="space-y-1.5 px-4">
        <div className="truncate text-xs font-medium text-muted-foreground">{kpi.label}</div>
        <div className="text-2xl leading-none font-semibold tracking-tight tabular-nums" title={kpi.format === "inr" ? formatINR(kpi.value) : undefined}>
          {kpi.format === "inr" ? formatINRCompact(kpi.value) : kpi.value.toLocaleString("en-IN")}
        </div>
        {d !== null ? (
          <div className="flex items-center gap-1 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium tabular-nums",
                good === null ? "text-muted-foreground" : good ? "text-tone-green" : "text-tone-red",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {Math.abs(d) < 0.5 ? "0%" : `${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}%`}
            </span>
            <span className="truncate text-muted-foreground">{compareLabel}</span>
          </div>
        ) : (
          <div className="h-4" />
        )}
        {kpi.sub && <div className="truncate text-[11px] text-muted-foreground" title={kpi.sub}>{kpi.sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Pipeline ────────────────────────────────────────────────────────────────
export async function Pipeline({ scope, perms }: { scope: Scope; perms: Perms }) {
  const p = await getPipeline(scope);
  const openLeads = p.leads.filter((l) => !["WON", "LOST"].includes(l.stage));
  const maxLead = Math.max(...openLeads.map((l) => l.count), 1);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sales pipeline</CardTitle>
          <CardDescription>Open leads &amp; offers now · won, lost and closed offers in the selected period</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2 2xl:grid-cols-[minmax(260px,1fr)_1.3fr_auto]">
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Leads by stage</h4>
          <ul className="space-y-2">
            {openLeads.map((l) => (
              <li key={l.stage} className="grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] items-center gap-2 text-sm" title={perms.money && l.value ? `Approx. budget ${inr0(l.value)}` : undefined}>
                <span className="truncate">{statusDef("lead", l.stage).label}</span>
                <div className="h-5 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${(l.count / maxLead) * 100}%`, background: "var(--chart-1)" }} />
                </div>
                <span className="w-6 text-right font-medium tabular-nums">{l.count}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2 text-xs">
            {p.leads.filter((l) => ["WON", "LOST"].includes(l.stage)).map((l) => (
              <span key={l.stage} className="flex items-center gap-1.5">
                <StatusBadge kind="lead" value={l.stage} /> <span className="tabular-nums">{l.count}</span>
              </span>
            ))}
            <span className="text-muted-foreground">in period</span>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Offers by status{perms.money && " (value excl. GST)"}</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.offers.map((o) => (
              <div key={o.status} className="rounded-lg border bg-card-solid/60 p-3">
                <StatusBadge kind="offer" value={o.status} />
                <div className="mt-2 text-xl font-semibold tabular-nums">{o.count}</div>
                {perms.money && <div className="text-xs text-muted-foreground tabular-nums">{formatINRCompact(o.value)}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 md:col-span-2 2xl:col-span-1 2xl:flex-col">
          <Stat label="Conversion rate" value={formatPercent(p.conversion)} hint={p.decided ? `${p.decided} offer${p.decided === 1 ? "" : "s"} decided in period` : "No offers decided yet"} />
          <Stat label="Avg. days to close" value={p.avgDays === null ? "—" : `${p.avgDays.toFixed(1)}`} hint="Offer date → accepted" />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex-1 rounded-lg border bg-card-solid/60 p-3 2xl:w-40 2xl:flex-none">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

// ─── Charts grid ─────────────────────────────────────────────────────────────
export async function ChartsGrid({ scope, perms }: { scope: Scope; perms: Perms }) {
  const c = await getCharts(scope, { profit: perms.profit });
  const people = c.workload;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {perms.money && (
        <SectionCard
          title="Invoiced vs received"
          description="Last 12 months · both incl. GST (received includes TDS deducted by clients)"
          className="lg:col-span-2"
          table={{ columns: ["Month", "Invoiced", "Received"], rows: c.revenue12.map((r) => [r.month, inr0(r.invoiced), inr0(r.received)]) }}
        >
          <RevenueTrendChart data={c.revenue12} />
        </SectionCard>
      )}

      {perms.money && (
        <SectionCard
          title="Revenue by service"
          description="Selected period · excl. GST"
          table={{ columns: ["Service", "Revenue"], rows: c.revenueByService.map((r) => [r.name, inr0(r.value)]) }}
        >
          <ServiceRevenueChart data={c.revenueByService} />
        </SectionCard>
      )}

      <SectionCard
        title="Sector-wise"
        description={perms.money ? "Clients, active projects & revenue (period, excl. GST)" : "Clients & active projects"}
      >
        {c.sectorRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Sector</th>
                  <th className="pb-2 text-right font-medium">Clients</th>
                  <th className="pb-2 text-right font-medium">Active proj.</th>
                  {perms.money && <th className="w-[38%] pb-2 pl-4 text-left font-medium">Revenue</th>}
                </tr>
              </thead>
              <tbody>
                {c.sectorRows.map((r) => {
                  const max = Math.max(...c.sectorRows.map((x) => x.revenue), 1);
                  return (
                    <tr key={r.name} className="border-t">
                      <td className="max-w-44 truncate py-2" title={r.name}>{r.name}</td>
                      <td className="py-2 text-right tabular-nums">{r.clients}</td>
                      <td className="py-2 text-right tabular-nums">{r.activeProjects}</td>
                      {perms.money && (
                        <td className="py-2 pl-4">
                          <div className="flex items-center gap-2" title={inr0(r.revenue)}>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(r.revenue / max) * 100}%` }} />
                            </div>
                            <span className="w-14 text-right text-xs tabular-nums">{formatINRCompact(r.revenue)}</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Lead sources"
        description="New leads & conversions in the period, and revenue from clients by source"
        table={{
          columns: ["Source", "Leads", "Conversions", ...(perms.money ? ["Revenue"] : [])],
          rows: c.sourceRows.map((r) => [r.name, r.leads, r.conversions, ...(perms.money ? [inr0(r.revenue)] : [])]),
        }}
      >
        {c.sourceRows.some((r) => r.leads || r.conversions) ? (
          <LeadSourceChart data={c.sourceRows.filter((r) => r.leads || r.conversions)} />
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">No new leads in this period</p>
        )}
        {perms.money && (
          <div className="mt-4 border-t pt-4">
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">Revenue by source (excl. GST)</h4>
            <BarList
              items={c.sourceRows.filter((r) => r.revenue).sort((a, b) => b.revenue - a.revenue).map((r) => ({ label: r.name, value: r.revenue }))}
              format={formatINRCompact}
              color="var(--chart-1)"
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Team workload"
        description="Open tasks now, and completed tasks in the period (on time vs late)"
        table={{
          columns: ["Employee", "Open – on schedule", "Open – overdue", "Done on time", "Done late"],
          rows: people.map((p) => [p.fullName, p.onSchedule, p.overdue, p.onTime, p.late]),
        }}
      >
        {people.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tasks</p>
        ) : (
          <div className="space-y-5">
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">Open tasks</h4>
              <StackedPeopleChart
                data={people}
                series={[
                  { key: "onSchedule", name: "On schedule", color: "var(--chart-1)" },
                  { key: "overdue", name: "Overdue", color: "var(--tone-red)" },
                ]}
              />
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">Completed in period</h4>
              <StackedPeopleChart
                data={people.filter((p) => p.onTime + p.late > 0)}
                series={[
                  { key: "onTime", name: "On time", color: "var(--chart-3)" },
                  { key: "late", name: "Late", color: "var(--chart-2)" },
                ]}
              />
            </div>
            {c.deptWorkload.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t pt-3">
                {c.deptWorkload.map((d) => (
                  <span key={d.name} className="rounded-full border bg-card-solid px-2.5 py-1 text-xs">
                    {d.name} <span className="font-semibold tabular-nums">{d.open}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Deliverables this month" description={`${formatMonthKey(c.curMonth)} · committed vs delivered across retainers`}>
        {c.deliverableRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No deliverables committed this month</p>
        ) : (
          <ul className="space-y-4">
            {c.deliverableRows.map((d) => {
              const pct = d.committed ? Math.round((d.delivered / d.committed) * 100) : 0;
              return (
                <li key={d.label}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{d.label}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{d.delivered}</span>
                      <span className="text-muted-foreground"> / {d.committed} · {pct}%</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.label} delivered`}>
                    <div className="h-full rounded-full bg-[var(--chart-3)]" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {perms.money && (
        <SectionCard title="Top 5 clients" description="Selected period · excl. GST">
          <div className={cn("grid gap-6", perms.profit && "sm:grid-cols-2")}>
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted-foreground">By revenue</h4>
              <BarList items={c.topRevenue.map((r) => ({ label: r.name, value: r.value }))} format={formatINRCompact} />
            </div>
            {perms.profit && (
              <div>
                <h4 className="mb-2 text-xs font-medium text-muted-foreground">By profit</h4>
                <BarList
                  items={c.topProfit.map((r) => ({ label: r.name, value: r.value, hint: `Revenue ${inr0(r.revenue)} − costs ${inr0(r.cost)}` }))}
                  format={formatINRCompact}
                  color="var(--chart-3)"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">Profit = revenue − linked expenses − logged hours × employee cost</p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {perms.money && (
        <SectionCard
          title="Outstanding ageing"
          description="Unpaid tax invoices by days past due"
          table={{ columns: ["Bucket", "Invoices", "Amount"], rows: c.ageing.map((a) => [a.label, a.count, inr0(a.amount)]) }}
        >
          <ul className="space-y-3">
            {c.ageing.map((a, i) => {
              const max = Math.max(...c.ageing.map((x) => x.amount), 1);
              // ordinal escalation: neutral → amber → red
              const color = ["var(--tone-grey)", "var(--tone-amber)", "color-mix(in oklab, var(--tone-amber) 50%, var(--tone-red))", "var(--tone-red)", "color-mix(in oklab, var(--tone-red) 75%, black)"][i];
              return (
                <li key={a.key} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm" title={`${a.count} invoice(s)`}>
                  <span>{a.label}</span>
                  <div className="h-5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded" style={{ width: `${a.amount ? Math.max(2, (a.amount / max) * 100) : 0}%`, background: color }} />
                  </div>
                  <span className="w-24 text-right tabular-nums">
                    {a.amount ? formatINRCompact(a.amount) : "—"}
                    <span className="ml-1 text-xs text-muted-foreground">({a.count})</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Alerts / table / deadlines ──────────────────────────────────────────────
export async function AlertsSection({ scope, perms }: { scope: Scope; perms: Perms }) {
  const settings = await getSettings();
  const { alerts, hiddenCount } = await getAlerts(scope, {
    money: perms.money,
    settings: {
      approvalWaitDays: settings?.approvalWaitDays ?? 2,
      adBudgetAlertPercent: settings?.adBudgetAlertPercent ?? 85,
      retainerEndingDays: settings?.retainerEndingDays ?? 30,
      shortfallDaysLeft: settings?.shortfallDaysLeft ?? 5,
      renewalAlertDays: settings?.renewalAlertDays ?? [30, 15, 7, 1],
      dueSoonDays: settings?.dueSoonDays ?? 3,
    },
  });
  return <AlertsPanel alerts={alerts} categories={ALERT_CATEGORIES} hiddenCount={hiddenCount} />;
}

export async function ClientWorkSection({ scope, perms }: { scope: Scope; perms: Perms }) {
  const rows = await getClientWork(scope);
  return <ClientWorkTable rows={rows} showMoney={perms.money} todayKey={scope.today} />;
}

export async function DeadlinesSection({ scope, perms }: { scope: Scope; perms: Perms }) {
  const items = await getDeadlines(scope, { money: perms.money });
  return <Deadlines items={items} todayKey={scope.today} />;
}

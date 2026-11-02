"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR, formatINRCompact } from "@/lib/money/format";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const GRID = "var(--chart-grid)";

type Fmt = (v: number) => string;

type TipProps = {
  active?: boolean;
  label?: unknown;
  payload?: readonly { dataKey?: unknown; name?: unknown; value?: unknown; color?: string }[];
  format: Fmt;
};

function ChartTooltip({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{String(label ?? "")}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{String(p.name ?? "")}</span>
          <span className="ml-auto pl-4 font-medium text-foreground tabular-nums">{format(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function LegendText(value: string) {
  return <span className="text-xs text-muted-foreground">{value}</span>;
}

/** Invoiced vs received — last 12 months (two series, grouped bars). */
export function RevenueTrendChart({ data }: { data: { month: string; invoiced: number; received: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatINRCompact(v)} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <ChartTooltip {...p} format={(v) => formatINR(v, { decimals: false })} />} />
          <Legend iconType="square" iconSize={10} formatter={LegendText} wrapperStyle={{ paddingTop: 8 }} />
          <Bar dataKey="invoiced" name="Invoiced (incl. GST)" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="received" name="Received (incl. TDS)" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Revenue by service — single series, horizontal, sorted. */
export function ServiceRevenueChart({ data }: { data: { name: string; value: number }[] }) {
  const height = Math.max(180, data.length * 34 + 20);
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINRCompact(v)} />
          <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={150} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <ChartTooltip {...p} format={(v) => formatINR(v, { decimals: false })} />} />
          <Bar dataKey="value" name="Revenue (excl. GST)" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Leads & conversions per source — two count series on one scale. */
export function LeadSourceChart({ data }: { data: { name: string; leads: number; conversions: number }[] }) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} angle={data.length > 5 ? -30 : 0} textAnchor={data.length > 5 ? "end" : "middle"} height={data.length > 5 ? 48 : 24} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <ChartTooltip {...p} format={(v) => String(v)} />} />
          <Legend iconType="square" iconSize={10} formatter={LegendText} />
          <Bar dataKey="leads" name="New leads" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          <Bar dataKey="conversions" name="Converted to client" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked horizontal bars per employee (2px surface gap between segments). */
export function StackedPeopleChart({
  data,
  series,
}: {
  data: Record<string, string | number>[];
  series: { key: string; name: string; color: string }[];
}) {
  const height = Math.max(140, data.length * 34 + 40);
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={64} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <ChartTooltip {...p} format={(v) => `${v} task${v === 1 ? "" : "s"}`} />} />
          <Legend iconType="square" iconSize={10} formatter={LegendText} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={s.color}
              stroke="var(--card-solid)"
              strokeWidth={2}
              radius={i === series.length - 1 ? [0, 4, 4, 0] : 0}
              maxBarSize={16}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

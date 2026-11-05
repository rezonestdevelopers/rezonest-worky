import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatINR } from "@/lib/money/format";
import { statusDef } from "@/lib/status";

/** Global search (Ctrl/Cmd+K). Results are limited by the user's role. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({});
  const contains = { contains: q, mode: "insensitive" as const };
  const role = user.role;
  const take = 6;

  const sales = can(role, "sales.manage");
  const finance = can(role, "finance.manage");
  const allWork = can(role, "work.manage");

  const [clients, offers, projects, tasks, invoices] = await Promise.all([
    sales
      ? db.client.findMany({
          where: { archivedAt: null, OR: [{ companyName: contains }, { email: contains }, { phone: contains }, { gstin: contains }, { contacts: { some: { name: contains } } }] },
          select: { id: true, companyName: true, city: true },
          take,
        })
      : [],
    sales
      ? db.offer.findMany({
          where: { archivedAt: null, isTemplate: false, OR: [{ number: contains }, { title: contains }, { client: { companyName: contains } }, { lead: { companyName: contains } }] },
          select: { id: true, number: true, title: true, status: true },
          orderBy: { offerDate: "desc" },
          take,
        })
      : [],
    db.project.findMany({
      where: {
        archivedAt: null,
        OR: [{ name: contains }, { code: contains }, { client: { companyName: contains } }],
        ...(allWork ? {} : { tasks: { some: { assigneeId: user.id } } }),
      },
      select: { id: true, name: true, code: true },
      take,
    }),
    db.task.findMany({
      where: {
        archivedAt: null,
        OR: [{ title: contains }, { client: { companyName: contains } }],
        ...(allWork ? {} : { assigneeId: user.id }),
      },
      select: { id: true, title: true, status: true, client: { select: { companyName: true } } },
      orderBy: { dueDate: "desc" },
      take,
    }),
    finance
      ? db.invoice.findMany({
          where: { NOT: { status: "CANCELLED", number: null }, OR: [{ number: contains }, { client: { companyName: contains } }] },
          select: { id: true, number: true, grandTotal: true, paymentStatus: true, status: true, client: { select: { companyName: true } } },
          orderBy: { invoiceDate: "desc" },
          take,
        })
      : [],
  ]);

  return NextResponse.json({
    clients: clients.map((c) => ({ id: c.id, title: c.companyName, subtitle: c.city ?? undefined, href: `/clients/${c.id}` })),
    offers: offers.map((o) => ({ id: o.id, title: `${o.number} · ${o.title}`, subtitle: statusDef("offer", o.status).label, href: `/offers/${o.id}` })),
    projects: projects.map((p) => ({ id: p.id, title: p.name, subtitle: p.code, href: `/projects/${p.id}` })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, subtitle: `${t.client?.companyName ?? ""} · ${statusDef("task", t.status).label}`, href: `/tasks/${t.id}` })),
    invoices: invoices.map((i) => ({
      id: i.id,
      title: `${i.number ?? "Draft"} · ${i.client.companyName}`,
      subtitle: `${formatINR(i.grandTotal)} · ${i.status === "DRAFT" ? "Draft" : statusDef("payment", i.paymentStatus).label}`,
      href: `/invoices/${i.id}`,
    })),
  });
}

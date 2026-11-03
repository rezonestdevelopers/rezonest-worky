import { requireUser } from "@/lib/auth-guard";
import { can, NAV_PERMISSION } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatDateTime, keyToDate, todayKey, addDaysKey } from "@/lib/dates";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { QuickAdd } from "@/components/layout/quick-add";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationBell } from "@/components/layout/notification-bell";

export const dynamic = "force-dynamic";

/** Count of things needing attention today (bell badge until the Phase 6 notification centre). */
async function attentionCount(userId: string, isAdmin: boolean) {
  const today = keyToDate(todayKey());
  const [unread, overdueTasks, overdueInvoices, renewals] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.task.count({
      where: {
        archivedAt: null,
        status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] },
        dueDate: { lt: today },
        ...(isAdmin ? {} : { assigneeId: userId }),
      },
    }),
    isAdmin ? db.invoice.count({ where: { type: "TAX", status: "ISSUED", paymentStatus: "OVERDUE" } }) : 0,
    isAdmin ? db.domainHostingAsset.count({ where: { archivedAt: null, expiryDate: { gte: today, lte: keyToDate(addDaysKey(todayKey(), 7)) } } }) : 0,
  ]);
  return unread + overdueTasks + overdueInvoices + renewals;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const allowed = Object.entries(NAV_PERMISSION)
    .filter(([, perm]) => can(user.role, perm))
    .map(([key]) => key);
  const [count, unread] = await Promise.all([
    attentionCount(user.id, user.role === "ADMIN"),
    db.notification.findMany({ where: { userId: user.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const bellItems = unread.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, when: formatDateTime(n.createdAt) }));

  return (
    <div className="app-bg flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <Sidebar allowed={allowed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 sm:px-5">
          <MobileNav allowed={allowed} />
          <div className="flex min-w-0 flex-1">
            <CommandPalette allowed={allowed} />
          </div>
          <QuickAdd allowed={allowed} />
          <NotificationBell count={count} items={bellItems} />
          <ThemeToggle />
          <UserMenu name={user.name} email={user.email} role={user.role} canSettings={can(user.role, "settings.manage")} />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

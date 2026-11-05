import { after } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { can, NAV_PERMISSION } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { runReminderJobIfStale } from "@/server/reminder-jobs";
import { reminderAttentionCount } from "@/server/services/reminders";
import { loadViewer } from "@/server/services/tasks";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { QuickAdd } from "@/components/layout/quick-add";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationBell } from "@/components/layout/notification-bell";

export const dynamic = "force-dynamic";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  after(runReminderJobIfStale);
  const allowed = Object.entries(NAV_PERMISSION)
    .filter(([, perm]) => can(user.role, perm))
    .map(([key]) => key);
  const [reminders, unreadCount, unread] = await Promise.all([
    loadViewer(db, user).then((viewer) => reminderAttentionCount(db, viewer)),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
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
          <QuickAdd allowed={can(user.role, "work.manage") ? [...allowed, "work.manage"] : allowed} />
          <NotificationBell reminders={reminders} unread={unreadCount} items={bellItems} />
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

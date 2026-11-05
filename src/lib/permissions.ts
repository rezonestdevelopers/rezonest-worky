export type Role = "ADMIN" | "MANAGER" | "EMPLOYEE";

/**
 * Permission matrix from the brief (§4). Every route / server action checks
 * one of these via `requirePermission` (src/lib/auth-guard.ts).
 */
export type Permission =
  | "dashboard.full" // money KPIs
  | "dashboard.profit"
  | "sales.manage" // leads, clients, offers
  | "work.manage" // all projects & tasks
  | "work.own" // own / department tasks
  | "finance.manage" // prices, invoices, payments, expenses, profit
  | "reports.monthly" // the client's monthly report: no fees, costs or team names
  | "team.manage"
  | "settings.manage";

const MATRIX: Record<Role, Permission[]> = {
  ADMIN: [
    "dashboard.full",
    "dashboard.profit",
    "sales.manage",
    "work.manage",
    "work.own",
    "finance.manage",
    "reports.monthly",
    "team.manage",
    "settings.manage",
  ],
  MANAGER: ["dashboard.full", "sales.manage", "work.manage", "work.own", "reports.monthly"],
  EMPLOYEE: ["work.own"],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role].includes(permission);
}

/** Which sidebar sections each role sees. */
export const NAV_PERMISSION: Record<string, Permission> = {
  dashboard: "work.own",
  leads: "sales.manage",
  clients: "sales.manage",
  offers: "sales.manage",
  projects: "work.own",
  tasks: "work.own",
  content: "work.own",
  ads: "work.manage",
  renewals: "finance.manage",
  invoices: "finance.manage",
  payments: "finance.manage",
  expenses: "finance.manage",
  reports: "reports.monthly",
  team: "team.manage",
  settings: "settings.manage",
};

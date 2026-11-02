import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CheckSquare,
  FileText,
  Globe,
  LayoutDashboard,
  Megaphone,
  Receipt,
  Settings,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  IndianRupee,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { key: string; label: string; href: string; icon: LucideIcon; phase: number };

/** Sidebar order from the brief. `phase` = when the section gets built. */
export const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, phase: 1 },
  { key: "leads", label: "Leads", href: "/leads", icon: UserPlus, phase: 2 },
  { key: "clients", label: "Clients", href: "/clients", icon: Users, phase: 2 },
  { key: "offers", label: "Offers", href: "/offers", icon: FileText, phase: 3 },
  { key: "projects", label: "Projects", href: "/projects", icon: Briefcase, phase: 4 },
  { key: "tasks", label: "Tasks", href: "/tasks", icon: CheckSquare, phase: 4 },
  { key: "content", label: "Content Calendar", href: "/content", icon: CalendarDays, phase: 5 },
  { key: "ads", label: "Ads", href: "/ads", icon: Megaphone, phase: 5 },
  { key: "renewals", label: "Renewals", href: "/renewals", icon: Globe, phase: 5 },
  { key: "invoices", label: "Invoices", href: "/invoices", icon: Receipt, phase: 7 },
  { key: "payments", label: "Payments", href: "/payments", icon: IndianRupee, phase: 7 },
  { key: "expenses", label: "Expenses", href: "/expenses", icon: Wallet, phase: 8 },
  { key: "reports", label: "Reports", href: "/reports", icon: BarChart3, phase: 9 },
  { key: "team", label: "Team", href: "/team", icon: UsersRound, phase: 4 },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings, phase: 1 },
];

export const NAV_BY_KEY = Object.fromEntries(NAV.map((n) => [n.key, n]));

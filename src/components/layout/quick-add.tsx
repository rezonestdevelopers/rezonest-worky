"use client";

import Link from "next/link";
import { CheckSquare, FileText, IndianRupee, Plus, Receipt, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ITEMS = [
  { label: "New Lead", href: "/leads/new", icon: UserPlus, perm: "leads" },
  { label: "New Client", href: "/clients/new", icon: Users, perm: "clients" },
  { label: "New Offer", href: "/offers/new", icon: FileText, perm: "offers" },
  { label: "New Task", href: "/tasks/new", icon: CheckSquare, perm: "tasks" },
  { label: "New Invoice", href: "/invoices/new", icon: Receipt, perm: "invoices" },
  { label: "Record Payment", href: "/payments/new", icon: IndianRupee, perm: "payments" },
];

export function QuickAdd({ allowed }: { allowed: string[] }) {
  const items = ITEMS.filter((i) => allowed.includes(i.perm));
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5" aria-label="Quick add">
          <Plus />
          <span className="hidden sm:inline">New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Quick add</DropdownMenuLabel>
        {items.map((i) => (
          <DropdownMenuItem key={i.href} asChild>
            <Link href={i.href}>
              <i.icon /> {i.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

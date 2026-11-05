"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/server/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email, role, canSettings }: { name: string; email: string; role: string; canSettings: boolean }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        aria-label="Account menu"
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium text-foreground">{name}</div>
          <div className="truncate text-xs">{email}</div>
          <div className="mt-1 text-[11px] tracking-wide uppercase">{role.toLowerCase()}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account"><UserRound /> My account</Link>
        </DropdownMenuItem>
        {canSettings && (
          <DropdownMenuItem asChild>
            <Link href="/settings"><Settings /> Settings</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void logoutAction()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

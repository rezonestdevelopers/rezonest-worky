"use client";

import * as React from "react";
import { Dialog as P } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = P.Root;
const SheetTrigger = P.Trigger;
const SheetClose = P.Close;
const SheetTitle = P.Title;

function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentProps<typeof P.Content> & { side?: "left" | "right" }) {
  return (
    <P.Portal>
      <P.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <P.Content
        aria-describedby={undefined}
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-popover shadow-xl transition ease-in-out data-[state=open]:animate-in data-[state=open]:duration-200",
          side === "left" ? "left-0 border-r data-[state=open]:slide-in-from-left" : "right-0 border-l data-[state=open]:slide-in-from-right",
          className,
        )}
        {...props}
      >
        {children}
        <P.Close className="absolute top-4 right-4 rounded-sm opacity-70 hover:opacity-100">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </P.Close>
      </P.Content>
    </P.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle };

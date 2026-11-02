"use client";

import * as React from "react";
import { Tooltip as P } from "radix-ui";
import { cn } from "@/lib/utils";

const TooltipProvider = P.Provider;
const Tooltip = P.Root;
const TooltipTrigger = P.Trigger;

function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        className={cn("z-50 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow animate-in fade-in-0", className)}
        {...props}
      />
    </P.Portal>
  );
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };

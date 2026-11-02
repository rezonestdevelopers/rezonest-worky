import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      tone: {
        green: "border-tone-green/25 bg-tone-green/12 text-tone-green",
        amber: "border-tone-amber/30 bg-tone-amber/14 text-[color-mix(in_oklab,var(--tone-amber)_75%,var(--foreground))]",
        red: "border-tone-red/25 bg-tone-red/12 text-tone-red",
        blue: "border-tone-blue/25 bg-tone-blue/12 text-tone-blue",
        violet: "border-tone-violet/25 bg-tone-violet/12 text-tone-violet",
        grey: "border-border bg-muted text-muted-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: { tone: "grey" },
  },
);

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };

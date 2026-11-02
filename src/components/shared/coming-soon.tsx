import Link from "next/link";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_BY_KEY } from "@/components/layout/nav";

export function ComingSoon({ section }: { section: string }) {
  const item = NAV_BY_KEY[section];
  const Icon = item?.icon ?? Construction;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-7" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">{item?.label ?? "This section"} is coming in Phase {item?.phase}</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The data already exists (you can see it on the Dashboard). Screens to view, add and edit it will be built in Phase {item?.phase}.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to Dashboard</Link>
      </Button>
    </div>
  );
}

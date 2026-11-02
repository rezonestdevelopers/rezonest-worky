"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle className="size-10 text-tone-red" />
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page could not be loaded. Please try again. If it keeps happening, share this code with your developer: {error.digest ?? "n/a"}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

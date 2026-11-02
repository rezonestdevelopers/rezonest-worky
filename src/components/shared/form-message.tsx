import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function FormMessage({ error, success, className }: { error?: string; success?: string; className?: string }) {
  if (!error && !success) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        error ? "border-tone-red/30 bg-tone-red/10 text-tone-red" : "border-tone-green/30 bg-tone-green/10 text-tone-green",
        className,
      )}
    >
      {error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
      <span>{error ?? success}</span>
    </div>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="app-bg flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Button asChild variant="outline"><Link href="/dashboard">Go to Dashboard</Link></Button>
    </main>
  );
}

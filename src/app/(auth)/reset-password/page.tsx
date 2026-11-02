import Link from "next/link";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div className="space-y-3 text-sm">
        <p>This reset link is incomplete.</p>
        <Link href="/forgot-password" className="text-primary hover:underline">Request a new link</Link>
      </div>
    );
  }
  return <ResetForm token={token} />;
}

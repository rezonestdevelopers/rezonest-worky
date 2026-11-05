import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { InstallCard, PasswordCard, ProfileCard } from "./account-forms";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requirePermission("work.own");
  const profile = await db.employeeProfile.findUnique({ where: { userId: user.id }, select: { phone: true, dailyDigest: true, emailOnTask: true } });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="My account" description={user.email} />
      <ProfileCard name={user.name} phone={profile?.phone ?? ""} dailyDigest={profile?.dailyDigest ?? false} emailOnTask={profile?.emailOnTask ?? false} />
      <PasswordCard />
      <InstallCard />
    </div>
  );
}

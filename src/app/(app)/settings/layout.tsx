import { requirePermission } from "@/lib/auth-guard";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("settings.manage");
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <SettingsNav />
      {children}
    </div>
  );
}

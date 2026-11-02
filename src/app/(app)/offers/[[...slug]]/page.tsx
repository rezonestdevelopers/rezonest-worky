import { requirePermission } from "@/lib/auth-guard";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function Page() {
  await requirePermission("sales.manage");
  return <ComingSoon section="offers" />;
}

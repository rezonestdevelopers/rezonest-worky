import { requirePermission } from "@/lib/auth-guard";
import { ComingSoon } from "@/components/shared/coming-soon";

export default async function Page() {
  await requirePermission("finance.manage");
  return <ComingSoon section="renewals" />;
}

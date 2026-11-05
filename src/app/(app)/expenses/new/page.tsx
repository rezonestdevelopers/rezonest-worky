import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { todayKey } from "@/lib/dates";
import { idParam, type SearchParams } from "@/lib/list-params";
import { getExpenseFormOptions } from "@/server/queries/expenses";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "Add expense" };

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("finance.manage");
  const sp = await searchParams;
  const options = await getExpenseFormOptions();
  const client = idParam(sp, "client");
  const project = idParam(sp, "project");
  const today = todayKey();
  const projectRow = options.projects.find((p) => p.value === project);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Add expense" description="You can attach the bill on the next screen." back={{ href: "/expenses", label: "Expenses" }} />
      <ExpenseForm
        id={null}
        options={options}
        today={today}
        defaults={{ date: today, category: "OTHER", description: "", vendor: "", amount: "", gstPaid: "", clientId: projectRow?.clientId ?? (options.clients.some((c) => c.value === client) ? client! : ""), projectId: projectRow?.value ?? "" }}
      />
    </div>
  );
}

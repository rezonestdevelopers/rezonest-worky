import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { dateOnlyKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { setExpenseArchivedAction } from "@/server/actions/expenses";
import { getExpense, getExpenseFormOptions } from "@/server/queries/expenses";
import { BillCard, ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.manage");
  const { id } = await params;
  const expense = await getExpense(id);
  if (!expense) notFound();
  const [options, bill] = await Promise.all([
    getExpenseFormOptions({ clientId: expense.clientId, projectId: expense.projectId }),
    expense.billDocId ? db.document.findUnique({ where: { id: expense.billDocId }, select: { id: true, name: true, mimeType: true, sizeBytes: true } }) : null,
  ]);
  const archived = !!expense.archivedAt;
  const restore = setExpenseArchivedAction.bind(null, id, false);
  const archive = setExpenseArchivedAction.bind(null, id, true);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={expense.description}
        back={{ href: "/expenses", label: "Expenses" }}
        actions={
          archived ? (
            <div className="flex items-center gap-2">
              <Badge tone="grey">Archived</Badge>
              <ConfirmButton label="Restore" icon={<ArchiveRestore />} title="Restore this expense?" description="It counts in profit again." confirmLabel="Restore" action={restore} />
            </div>
          ) : (
            <ConfirmButton label="Archive" icon={<Archive />} title="Archive this expense?" description="It stops counting in profit. It stays on record and can be restored." confirmLabel="Archive" action={archive} />
          )
        }
      />
      <ExpenseForm
        id={id}
        options={options}
        today={todayKey()}
        defaults={{ date: dateOnlyKey(expense.date), category: expense.category, description: expense.description, vendor: expense.vendor ?? "", amount: expense.amount.toString(), gstPaid: expense.gstPaid.isZero() ? "" : expense.gstPaid.toString(), clientId: expense.clientId ?? "", projectId: expense.projectId ?? "" }}
      />
      {!archived && <BillCard expenseId={id} bill={bill} />}
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { templateDefinition } from "@/lib/email-templates";
import { getTemplate } from "@/server/services/email-templates";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Edit email template" };

export default async function EmailTemplatePage({ params }: { params: Promise<{ key: string }> }) {
  await requirePermission("settings.manage");
  const { key } = await params;
  const definition = templateDefinition(key);
  if (!definition) notFound();
  const template = await getTemplate(db, key);
  return (
    <div className="space-y-4">
      <PageHeader title={definition.name} description={definition.when} back={{ href: "/settings/emails", label: "Email templates" }} />
      <TemplateEditor templateKey={key} subject={template.subject} body={template.body} whatsapp={template.whatsapp} hasWhatsapp={definition.whatsapp !== null} placeholders={definition.placeholders} />
    </div>
  );
}

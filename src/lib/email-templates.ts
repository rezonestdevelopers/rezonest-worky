/** Every message the app sends. Text can be edited in Settings; these are the starting points and what Reset restores. */
export type TemplateDefinition = {
  key: string;
  name: string;
  /** When this goes out, in plain words. */
  when: string;
  subject: string;
  body: string;
  whatsapp: string | null;
  /** The {{placeholders}} it can use, each with an example for the preview. */
  placeholders: Record<string, string>;
};

const INVOICE = { contactName: "Asha Patil", invoiceNumber: "REZ/INV/2026-27/0042", amount: "₹29,500.00", dueDate: "20 Nov 2026", upiId: "rezonest@upi", agencyName: "Rezonest Digital & Services" };
const DIGEST_SECTIONS = "OVERDUE TASKS (2)\n- Post #3: design & caption: Asha Foods · Priya · 2 days overdue\n- Weekly ads report: Vertex · Sneha · 1 day overdue\n\nRENEWALS (1)\n- Domain expires in 7 days: example.com: Asha Foods · 11 Nov 2026";

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: "offer_send",
    name: "Send offer",
    when: "When you email an offer to a client.",
    subject: "Quotation {{offerNumber}} from {{agencyName}}",
    body: "Dear {{contactName}},\n\nThank you for your interest. Please find our quotation {{offerNumber}} for {{offerTitle}}.\n\nView & accept online: {{offerLink}}\n\nThis offer is valid until {{validUntil}}.\n\nWarm regards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, please find our quotation {{offerNumber}} for {{offerTitle}}: {{offerLink}} — Team Rezonest",
    placeholders: { contactName: "Asha Patil", offerNumber: "REZ/QT/2026-27/0015", offerTitle: "Social media retainer", offerLink: "https://example.com/p/offer/…", validUntil: "20 Nov 2026", agencyName: "Rezonest Digital & Services" },
  },
  {
    key: "content_approval",
    name: "Content for approval",
    when: "When you send a client their month's content to approve.",
    subject: "{{month}} content for your approval",
    body: "Hello {{contactName}},\n\nPlease review the {{month}} content for {{companyName}}. You can approve each item or ask for changes here, with no login needed:\n\n{{link}}\n\nThe link works for {{linkDays}} days.\n\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, please review the {{month}} content for {{companyName}}. You can approve each item or ask for changes here, with no login needed:\n\n{{link}}",
    placeholders: { contactName: "Asha Patil", companyName: "Asha Foods", month: "Nov 2026", link: "https://example.com/p/content/…", linkDays: "30", agencyName: "Rezonest Digital & Services" },
  },
  {
    key: "daily_digest",
    name: "Your daily digest",
    when: "Every day at your digest time, to admins.",
    subject: "{{date}}: {{summary}}",
    body: "Good morning {{name}},\n\n{{summary}}\n\n{{sections}}\n\nSee everything: {{link}}\n\n{{agencyName}}",
    whatsapp: null,
    placeholders: { name: "Yogeshwar", date: "04 Nov 2026", summary: "3 need attention", sections: DIGEST_SECTIONS, link: "https://example.com/notifications", agencyName: "Rezonest Digital & Services" },
  },
  {
    key: "employee_digest",
    name: "Employee's daily tasks",
    when: "Every day at your digest time, to team members with the daily task email on. Skipped if they've nothing due.",
    subject: "Your tasks for {{date}}: {{summary}}",
    body: "Good morning {{name}},\n\n{{sections}}\n\nOpen your tasks: {{link}}\n\n{{agencyName}}",
    whatsapp: null,
    placeholders: { name: "Priya", date: "04 Nov 2026", summary: "2 overdue, 1 due today", sections: "OVERDUE TASKS (2)\n- Post #3: design & caption: Asha Foods\n- Reel #1: edit: Vertex\n\nDUE TODAY (1)\n- Post #4: design & caption: Asha Foods", link: "https://example.com/tasks?mine=1", agencyName: "Rezonest Digital & Services" },
  },
  {
    key: "task_notification",
    name: "Task assigned or mentioned",
    when: "When someone with this email turned on is given a task or mentioned in a comment.",
    subject: "{{title}}",
    body: "Hello {{name}},\n\n{{title}}\n{{details}}\n\nOpen it: {{link}}\n\n{{agencyName}}",
    whatsapp: null,
    placeholders: { name: "Priya", title: "New task for you", details: "Post #3: design & caption", link: "https://example.com/tasks/…", agencyName: "Rezonest Digital & Services" },
  },
  {
    key: "team_invite",
    name: "Team member invitation",
    when: "When you add a person, or send them a password link.",
    subject: "Welcome to {{agencyName}} Work OS",
    body: "Hello {{name}},\n\nAn account has been created for you. Choose your password here. The link works for 3 days and only once:\n\n{{link}}\n\nThen sign in with this email address.\n\n{{agencyName}}",
    whatsapp: null,
    placeholders: { name: "Priya", link: "https://example.com/reset-password?token=…", agencyName: "Rezonest Digital & Services" },
  },
  {
    key: "password_reset",
    name: "Password reset",
    when: "When someone uses “Forgot password”.",
    subject: "Reset your Rezonest Work OS password",
    body: "Hello {{name}},\n\nClick the link below to set a new password. The link is valid for 1 hour.\n\n{{resetLink}}\n\nIf you did not request this, you can ignore this email.",
    whatsapp: null,
    placeholders: { name: "Priya", resetLink: "https://example.com/reset-password?token=…" },
  },
  {
    key: "invoice_send",
    name: "Send invoice",
    when: "When you send an invoice.",
    subject: "Invoice {{invoiceNumber}} — {{amount}}",
    body: "Dear {{contactName}},\n\nPlease find attached invoice {{invoiceNumber}} for {{amount}}, due on {{dueDate}}.\n\nUPI: {{upiId}}\n\nThank you,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}. UPI: {{upiId}} — Team Rezonest",
    placeholders: INVOICE,
  },
  {
    key: "payment_reminder_polite",
    name: "Payment reminder: polite",
    when: "When you click to send a polite reminder. Never sent by itself.",
    subject: "Gentle reminder: invoice {{invoiceNumber}}",
    body: "Dear {{contactName}},\n\nThis is a gentle reminder that invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}. If already paid, please ignore this message.\n\nRegards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, gentle reminder: invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}. Please ignore if already paid. 🙏",
    placeholders: INVOICE,
  },
  {
    key: "payment_reminder_firm",
    name: "Payment reminder: firm",
    when: "When you click to send a firm reminder. Never sent by itself.",
    subject: "Payment overdue: invoice {{invoiceNumber}}",
    body: "Dear {{contactName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is now overdue since {{dueDate}}. Kindly arrange the payment at the earliest.\n\nRegards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, invoice {{invoiceNumber}} ({{amount}}) is overdue since {{dueDate}}. Kindly arrange payment at the earliest.",
    placeholders: INVOICE,
  },
  {
    key: "payment_reminder_final",
    name: "Payment reminder: final",
    when: "When you click to send a final reminder. Never sent by itself.",
    subject: "Final reminder: invoice {{invoiceNumber}}",
    body: "Dear {{contactName}},\n\nDespite earlier reminders, invoice {{invoiceNumber}} for {{amount}} remains unpaid. Please clear the dues within 3 days to avoid interruption of services.\n\nRegards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, final reminder for invoice {{invoiceNumber}} ({{amount}}). Please clear within 3 days to avoid service interruption.",
    placeholders: INVOICE,
  },
];

export const templateDefinition = (key: string) => TEMPLATE_DEFINITIONS.find((t) => t.key === key);

/** Fills in {{placeholders}}. Pure, so the on-screen preview and the real email always match. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
}

export function renderTemplate(t: { subject: string; body: string; whatsapp?: string | null }, values: Record<string, string>) {
  return {
    subject: fillPlaceholders(t.subject, values),
    text: fillPlaceholders(t.body, values),
    whatsapp: t.whatsapp ? fillPlaceholders(t.whatsapp, values) : null,
  };
}

/** Placeholders this message can't fill: a typo here would send a blank to a client. */
export function unknownPlaceholders(key: string, text: string): string[] {
  const allowed = Object.keys(templateDefinition(key)?.placeholders ?? {});
  const used = Array.from(text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g), (m) => m[1]);
  return Array.from(new Set(used.filter((p) => !allowed.includes(p))));
}

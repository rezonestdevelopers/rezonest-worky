import type { BillingType, Prisma, PrismaClient, Priority } from "@prisma/client";

/**
 * Master data — kept when sample data is wiped. Safe to re-run (upserts).
 */

export const DEPARTMENTS = [
  "Strategy & Digital Marketing",
  "Social Media",
  "Design & Video",
  "Performance Ads (Meta/Google)",
  "SEO",
  "Web & Software Development",
  "Accounts",
] as const;

export const SECTORS = [
  "Manufacturing & Industrial (MIDC)",
  "Automobile & Auto Components",
  "Real Estate & Construction",
  "Healthcare & Clinics",
  "Education & Coaching",
  "Retail & E-commerce",
  "Hospitality & Restaurants",
  "IT & Services",
  "Finance & Insurance",
  "Personal Brand",
  "Other",
] as const;

export const LEAD_SOURCES = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "Website",
  "Google",
  "Referral",
  "WhatsApp",
  "Walk-in",
  "Cold call",
  "Other",
] as const;

type Step = { title: string; dept?: string; days?: number; approval?: boolean; priority?: Priority };
type Tpl = { name: string; sub?: string; steps: Step[] };
type Sub = { name: string; billingType?: BillingType; price?: number; unit?: string };
type ServiceDef = {
  slug: string;
  name: string;
  dept: string;
  billingType: BillingType;
  price: number;
  unit: string;
  subs: Sub[];
  kpis: { metric: string; unit: string }[];
  deliverables: { name: string; qty: number; unit: string }[];
  templates: Tpl[];
  onboarding: string[];
};

export const SERVICES: ServiceDef[] = [
  {
    slug: "digital-marketing",
    name: "Digital Marketing",
    dept: "Strategy & Digital Marketing",
    billingType: "MONTHLY_RETAINER",
    price: 30000,
    unit: "month",
    subs: [
      { name: "Strategy & Campaign Planning" },
      { name: "Lead Generation" },
      { name: "Google Ads" },
      { name: "Email Marketing" },
      { name: "WhatsApp Marketing" },
      { name: "Monthly Performance Report" },
    ],
    kpis: [
      { metric: "Leads", unit: "count" },
      { metric: "Cost per lead", unit: "₹" },
      { metric: "Website traffic", unit: "count" },
    ],
    deliverables: [{ name: "Monthly performance report", qty: 1, unit: "report" }],
    templates: [
      {
        name: "Monthly Digital Marketing",
        steps: [
          { title: "Strategy review", days: 2 },
          { title: "Campaign planning", days: 3 },
          { title: "Campaign execution", days: 15 },
          { title: "Monthly performance report", days: 2, priority: "HIGH" },
        ],
      },
    ],
    onboarding: ["Google Analytics & Search Console access"],
  },
  {
    slug: "social-media",
    name: "Social Media Marketing",
    dept: "Social Media",
    billingType: "MONTHLY_RETAINER",
    price: 20000,
    unit: "month",
    subs: [
      { name: "Account Setup & Optimisation", billingType: "ONE_TIME", price: 5000, unit: "one-time" },
      { name: "Content Calendar" },
      { name: "Posting & Scheduling" },
      { name: "Community Management" },
    ],
    kpis: [
      { metric: "Posts per month", unit: "count" },
      { metric: "Reels per month", unit: "count" },
      { metric: "Followers", unit: "count" },
      { metric: "Reach", unit: "count" },
      { metric: "Engagement rate", unit: "%" },
    ],
    deliverables: [
      { name: "Static post", qty: 12, unit: "post" },
      { name: "Reel", qty: 4, unit: "reel" },
    ],
    templates: [
      {
        name: "Monthly Social Media",
        steps: [
          { title: "Content calendar for the month", days: 2, approval: false, priority: "HIGH" },
          { title: "Client approval of calendar", days: 2, approval: true },
          { title: "Posting & scheduling", days: 20 },
          { title: "Community management", days: 25 },
          { title: "Monthly insights report", days: 2 },
        ],
      },
    ],
    onboarding: ["Instagram / Facebook page access", "Logo & brand guidelines received"],
  },
  {
    slug: "reels-posts",
    name: "Reels & Posts",
    dept: "Design & Video",
    billingType: "PER_UNIT",
    price: 1500,
    unit: "unit",
    subs: [
      { name: "Static Post", price: 1200, unit: "post" },
      { name: "Carousel", price: 1800, unit: "carousel" },
      { name: "Reel", price: 3500, unit: "reel" },
      { name: "Story", price: 500, unit: "story" },
      { name: "Monthly Package", billingType: "MONTHLY_RETAINER", price: 35000, unit: "month" },
    ],
    kpis: [
      { metric: "Posts delivered", unit: "count" },
      { metric: "Reels delivered", unit: "count" },
    ],
    deliverables: [
      { name: "Static post", qty: 12, unit: "post" },
      { name: "Reel", qty: 8, unit: "reel" },
    ],
    templates: [
      {
        name: "Reel",
        sub: "Reel",
        steps: [
          { title: "Concept / Script", dept: "Social Media", days: 1 },
          { title: "Shoot", days: 1 },
          { title: "Edit", days: 2 },
          { title: "Internal review", days: 1 },
          { title: "Client approval", days: 1, approval: true },
          { title: "Post", dept: "Social Media", days: 1 },
        ],
      },
      {
        name: "Post",
        sub: "Static Post",
        steps: [
          { title: "Caption & design", days: 1 },
          { title: "Internal review", days: 1 },
          { title: "Client approval", days: 1, approval: true },
          { title: "Schedule / Post", dept: "Social Media", days: 1 },
        ],
      },
    ],
    onboarding: ["Logo & brand guidelines received"],
  },
  {
    slug: "meta-ads",
    name: "Meta Ads",
    dept: "Performance Ads (Meta/Google)",
    billingType: "MONTHLY_RETAINER",
    price: 15000,
    unit: "month",
    subs: [{ name: "Facebook & Instagram Ads Management" }],
    kpis: [
      { metric: "Monthly ad budget", unit: "₹" },
      { metric: "Leads", unit: "count" },
      { metric: "CPL", unit: "₹" },
      { metric: "ROAS", unit: "x" },
    ],
    deliverables: [{ name: "Weekly ads report", qty: 4, unit: "report" }],
    templates: [
      {
        name: "Meta Ads Campaign",
        steps: [
          { title: "Audience research", days: 2 },
          { title: "Ad creatives", dept: "Design & Video", days: 3 },
          { title: "Campaign setup", days: 1 },
          { title: "Launch", days: 1, priority: "HIGH" },
          { title: "Optimisation", days: 20 },
          { title: "Weekly report", days: 1 },
        ],
      },
    ],
    onboarding: ["Meta Business Manager / ad account access", "Instagram / Facebook page access"],
  },
  {
    slug: "design-video",
    name: "Graphic Design & Video",
    dept: "Design & Video",
    billingType: "PER_UNIT",
    price: 2500,
    unit: "unit",
    subs: [
      { name: "Logo & Brand Identity", billingType: "ONE_TIME", price: 15000, unit: "project" },
      { name: "Creatives", price: 1500, unit: "creative" },
      { name: "Brochure / Catalogue", billingType: "ONE_TIME", price: 12000, unit: "project" },
      { name: "Video Shoot", billingType: "ONE_TIME", price: 15000, unit: "day" },
      { name: "Video Editing", price: 4000, unit: "video" },
      { name: "Motion Graphics", price: 6000, unit: "video" },
      { name: "YouTube Video", price: 8000, unit: "video" },
    ],
    kpis: [{ metric: "Deliverables", unit: "count" }],
    deliverables: [],
    templates: [
      {
        name: "Design Job",
        steps: [
          { title: "Brief & references", days: 1 },
          { title: "First draft", days: 2 },
          { title: "Internal review", days: 1 },
          { title: "Client approval", days: 2, approval: true },
          { title: "Final files delivered", days: 1 },
        ],
      },
    ],
    onboarding: ["Logo & brand guidelines received"],
  },
  {
    slug: "seo",
    name: "SEO Services",
    dept: "SEO",
    billingType: "MONTHLY_RETAINER",
    price: 15000,
    unit: "month",
    subs: [
      { name: "SEO Audit", billingType: "ONE_TIME", price: 8000, unit: "one-time" },
      { name: "Keyword Research" },
      { name: "On-page SEO" },
      { name: "Technical SEO" },
      { name: "Off-page / Backlinks" },
      { name: "Local SEO / Google Business Profile" },
      { name: "Monthly Ranking Report" },
    ],
    kpis: [
      { metric: "Keywords in top 10", unit: "count" },
      { metric: "Organic traffic", unit: "count" },
    ],
    deliverables: [{ name: "Monthly ranking report", qty: 1, unit: "report" }],
    templates: [
      {
        name: "Monthly SEO",
        steps: [
          { title: "SEO audit", days: 3 },
          { title: "Keyword research", days: 2 },
          { title: "On-page optimisation", days: 7 },
          { title: "Off-page / backlinks", days: 10 },
          { title: "Monthly ranking report", days: 2, priority: "HIGH" },
        ],
      },
    ],
    onboarding: ["Google Analytics & Search Console access", "Google Business Profile access", "Website / hosting access"],
  },
  {
    slug: "web-dev",
    name: "Web & Software Development",
    dept: "Web & Software Development",
    billingType: "MILESTONE",
    price: 60000,
    unit: "project",
    subs: [
      { name: "WordPress Website", price: 45000 },
      { name: "WooCommerce Store", price: 90000 },
      { name: "Next.js / MERN Web App", price: 150000 },
      { name: "Custom ERP / CRM", price: 250000 },
      { name: "UI/UX Design", price: 30000 },
      { name: "Website Maintenance", billingType: "MONTHLY_RETAINER", price: 3000, unit: "month" },
    ],
    kpis: [{ metric: "Milestones completed", unit: "count" }],
    deliverables: [],
    templates: [
      {
        name: "Website Project",
        steps: [
          { title: "Requirements & specs", days: 5 },
          { title: "UI/UX design", days: 10, approval: true },
          { title: "Development", days: 20 },
          { title: "Testing", days: 5 },
          { title: "Launch", days: 1, priority: "URGENT" },
          { title: "Maintenance handover", days: 2 },
        ],
      },
    ],
    onboarding: ["Website / hosting access", "Logo & brand guidelines received"],
  },
  {
    slug: "domain-hosting",
    name: "Domain & Hosting",
    dept: "Web & Software Development",
    billingType: "ANNUAL_RENEWAL",
    price: 6000,
    unit: "year",
    subs: [
      { name: "Domain Registration", price: 1200 },
      { name: "Web Hosting", price: 6000 },
      { name: "SSL Certificate", price: 2500 },
      { name: "Business Email", price: 1500, unit: "mailbox/year" },
    ],
    kpis: [],
    deliverables: [],
    templates: [
      {
        name: "Domain & Hosting Setup",
        steps: [
          { title: "Purchase / setup", days: 1 },
          { title: "DNS & SSL", days: 1 },
          { title: "Email setup", days: 1 },
          { title: "Renewal", days: 1 },
        ],
      },
    ],
    onboarding: [],
  },
];

export const GENERAL_ONBOARDING = ["Advance payment received", "Kick-off meeting done"];

export const EMAIL_TEMPLATES = [
  {
    key: "offer_send",
    name: "Send offer",
    subject: "Quotation {{offerNumber}} from Rezonest Digital & Services",
    body: "Dear {{contactName}},\n\nThank you for your interest. Please find our quotation {{offerNumber}} for {{offerTitle}}.\n\nView & accept online: {{offerLink}}\n\nThis offer is valid until {{validUntil}}.\n\nWarm regards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, please find our quotation {{offerNumber}} for {{offerTitle}}: {{offerLink}} — Team Rezonest",
  },
  {
    key: "invoice_send",
    name: "Send invoice",
    subject: "Invoice {{invoiceNumber}} — {{amount}}",
    body: "Dear {{contactName}},\n\nPlease find attached invoice {{invoiceNumber}} for {{amount}}, due on {{dueDate}}.\n\nUPI: {{upiId}}\n\nThank you,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}. UPI: {{upiId}} — Team Rezonest",
  },
  {
    key: "payment_reminder_polite",
    name: "Payment reminder — polite",
    subject: "Gentle reminder: invoice {{invoiceNumber}}",
    body: "Dear {{contactName}},\n\nThis is a gentle reminder that invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}. If already paid, please ignore this message.\n\nRegards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, gentle reminder: invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}. Please ignore if already paid. 🙏",
  },
  {
    key: "payment_reminder_firm",
    name: "Payment reminder — firm",
    subject: "Payment overdue: invoice {{invoiceNumber}}",
    body: "Dear {{contactName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is now overdue since {{dueDate}}. Kindly arrange the payment at the earliest.\n\nRegards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, invoice {{invoiceNumber}} ({{amount}}) is overdue since {{dueDate}}. Kindly arrange payment at the earliest.",
  },
  {
    key: "payment_reminder_final",
    name: "Payment reminder — final",
    subject: "Final reminder: invoice {{invoiceNumber}}",
    body: "Dear {{contactName}},\n\nDespite earlier reminders, invoice {{invoiceNumber}} for {{amount}} remains unpaid. Please clear the dues within 3 days to avoid interruption of services.\n\nRegards,\n{{agencyName}}",
    whatsapp: "Hello {{contactName}}, final reminder for invoice {{invoiceNumber}} ({{amount}}). Please clear within 3 days to avoid service interruption.",
  },
  {
    key: "password_reset",
    name: "Password reset",
    subject: "Reset your Rezonest Work OS password",
    body: "Hello {{name}},\n\nClick the link below to set a new password. The link is valid for 1 hour.\n\n{{resetLink}}\n\nIf you did not request this, you can ignore this email.",
    whatsapp: null,
  },
];

export const DEFAULT_SETTINGS: Prisma.SettingsCreateInput = {
  id: "agency",
  agencyName: "Rezonest Digital & Services",
  address:
    "Gera's Imperium Gateway, C Tower, C-340, Nashik Phata Metro, behind Bhosari Metro Station, Bhosari",
  city: "Pune",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "411034",
  email: "yogeshwar@rezonest.com",
  phone: "+91 9730258208",
  website: "rezonest.com",
};

export async function seedMasterData(db: PrismaClient) {
  await db.settings.upsert({ where: { id: "agency" }, update: {}, create: DEFAULT_SETTINGS });

  const deptIds: Record<string, string> = {};
  for (const [i, name] of DEPARTMENTS.entries()) {
    const d = await db.department.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
    deptIds[name] = d.id;
  }
  for (const [i, name] of SECTORS.entries()) {
    await db.sector.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }
  for (const [i, name] of LEAD_SOURCES.entries()) {
    await db.leadSource.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }

  for (const [i, s] of SERVICES.entries()) {
    const existing = await db.service.findUnique({ where: { slug: s.slug } });
    if (existing) continue; // never overwrite admin edits
    const service = await db.service.create({
      data: {
        slug: s.slug,
        name: s.name,
        departmentId: deptIds[s.dept],
        billingType: s.billingType,
        defaultPrice: s.price,
        unit: s.unit,
        gstRate: 18,
        revisionsIncluded: 2,
        defaultKpis: s.kpis,
        defaultDeliverables: s.deliverables,
        sortOrder: i,
        subServices: {
          create: s.subs.map((sub, j) => ({
            name: sub.name,
            billingType: sub.billingType,
            defaultPrice: sub.price,
            unit: sub.unit,
            sortOrder: j,
          })),
        },
      },
      include: { subServices: true },
    });
    for (const t of s.templates) {
      const sub = t.sub ? service.subServices.find((x) => x.name === t.sub) : undefined;
      let offset = 0;
      await db.taskTemplate.create({
        data: {
          serviceId: service.id,
          subServiceId: sub?.id,
          name: t.name,
          steps: {
            create: t.steps.map((st, k) => {
              const step = {
                title: st.title,
                departmentId: deptIds[st.dept ?? s.dept],
                sortOrder: k,
                offsetDays: offset,
                durationDays: st.days ?? 1,
                priority: st.priority ?? "MEDIUM",
                isClientApproval: !!st.approval,
              };
              offset += st.days ?? 1;
              return step;
            }),
          },
        },
      });
    }
    await db.onboardingTemplateItem.createMany({
      data: s.onboarding.map((title, k) => ({ serviceId: service.id, title, sortOrder: 10 + k })),
    });
  }

  if ((await db.onboardingTemplateItem.count({ where: { serviceId: null } })) === 0) {
    await db.onboardingTemplateItem.createMany({
      data: GENERAL_ONBOARDING.map((title, k) => ({ title, sortOrder: k })),
    });
  }

  for (const t of EMAIL_TEMPLATES) {
    await db.emailTemplate.upsert({ where: { key: t.key }, update: {}, create: t });
  }
}

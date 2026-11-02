import type {
  ContentFormat,
  OfferStatus,
  PaymentMode,
  Prisma,
  PrismaClient,
  TaskStatus,
  ExpenseCategory,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { addMonths } from "date-fns";
import {
  addDaysKey,
  dateOnlyKey,
  daysBetweenKeys,
  keyToDate,
  monthKeyOf,
  monthRange,
  shiftMonth,
  todayKey,
  formatMonthKey,
} from "../../src/lib/dates";
import { amountInWords, computePaymentStatus, computeTotals, determineTaxMode, invoiceBalance, toDecimal, type LineInput, type TaxMode } from "../../src/lib/money";
import { nextDocNumber } from "../../src/lib/numbering";
import { computeProjectHealth } from "../../src/lib/health";

/**
 * Realistic Pune-area sample data, generated RELATIVE TO TODAY so the
 * dashboard always looks current. Deterministic (seeded random).
 * Remove before go-live with: pnpm db:wipe-sample
 */

// ── deterministic random ─────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

const T = todayKey();
const CUR = monthKeyOf(T);
const k = (offset: number) => addDaysKey(T, offset);
const d = (offset: number) => keyToDate(k(offset));
/** instant at a given IST hour on a date key */
const at = (key: string, hour = 11) => new Date(keyToDate(key).getTime() + (hour * 60 - 330) * 60_000);
const minKey = (a: string, b: string) => (a < b ? a : b);
const maxKey = (a: string, b: string) => (a > b ? a : b);
const money = (v: { toFixed(n: number): string }) => v.toFixed(2);

// ── reference data ───────────────────────────────────────────────────────────
const EMPLOYEES = [
  { key: "priya", name: "Priya Deshmukh", email: "priya@rezonest.com", dept: "Social Media", designation: "Social Media Manager", cost: 350, phone: "+91 98220 41136" },
  { key: "rohan", name: "Rohan Patil", email: "rohan@rezonest.com", dept: "Design & Video", designation: "Video Editor & Designer", cost: 300, phone: "+91 97654 22819" },
  { key: "sneha", name: "Sneha Joshi", email: "sneha@rezonest.com", dept: "Performance Ads (Meta/Google)", designation: "Performance Marketing Specialist", cost: 400, phone: "+91 90110 57342" },
  { key: "amit", name: "Amit Shinde", email: "amit@rezonest.com", dept: "SEO", designation: "SEO Executive", cost: 280, phone: "+91 88050 63127" },
  { key: "kunal", name: "Kunal Jadhav", email: "kunal@rezonest.com", dept: "Web & Software Development", designation: "Full-stack Developer", cost: 450, phone: "+91 95520 18874" },
] as const;
type EmpKey = (typeof EMPLOYEES)[number]["key"];

const SERVICE_OWNER: Record<string, EmpKey> = {
  "digital-marketing": "sneha",
  "social-media": "priya",
  "reels-posts": "rohan",
  "meta-ads": "sneha",
  "design-video": "rohan",
  seo: "amit",
  "web-dev": "kunal",
  "domain-hosting": "kunal",
};

type PayBehaviour = "good" | "tds" | "late" | "partial" | "combined";

const CLIENTS = [
  { key: "kalyani", company: "Kalyani Auto Components Pvt Ltd", sector: "Automobile & Auto Components", source: "LinkedIn", city: "Chakan", contact: "Sanjay Kalyani", designation: "Director", phone: "+91 98230 11452", email: "sanjay@kalyaniauto.in", gstin: "27AAECK4521M1Z8", manager: "priya", pay: "good", tags: ["retainer", "B2B"] },
  { key: "pristine", company: "Pristine Heights Realty LLP", sector: "Real Estate & Construction", source: "Instagram", city: "Wakad", contact: "Neha Agarwal", designation: "Marketing Head", phone: "+91 99700 32418", email: "neha@pristineheights.in", gstin: "27AAQFP7781K1Z2", manager: "sneha", pay: "combined", tags: ["retainer", "high-value"] },
  { key: "sahyadri", company: "Sahyadri Smile Dental Clinic", sector: "Healthcare & Clinics", source: "Google", city: "Pimple Saudagar", contact: "Dr. Mahesh Pawar", designation: "Founder", phone: "+91 97300 84521", email: "drmahesh@sahyadrismile.com", gstin: null, manager: "priya", pay: "good", tags: ["retainer"] },
  { key: "brightpath", company: "BrightPath Coaching Academy", sector: "Education & Coaching", source: "Facebook", city: "Nigdi", contact: "Rahul Kale", designation: "Owner", phone: "+91 90496 22713", email: "admissions@brightpathacademy.in", gstin: "27BKLPK3312R1Z0", manager: "sneha", pay: "late", tags: ["retainer", "follow-up payments"] },
  { key: "rasoi", company: "Rasoi Ghar Family Restaurant", sector: "Hospitality & Restaurants", source: "Walk-in", city: "Pimpri", contact: "Vikas Shetty", designation: "Partner", phone: "+91 98811 56024", email: "rasoighar.pimpri@gmail.com", gstin: "27AHFPS9087C1ZX", manager: "rohan", pay: "partial", tags: ["reels"] },
  { key: "urbanthreads", company: "UrbanThreads Boutique", sector: "Retail & E-commerce", source: "Instagram", city: "Baner", contact: "Ritika Mehta", designation: "Founder", phone: "+91 98906 77310", email: "ritika@urbanthreads.in", gstin: "27AYMPM5523Q1Z4", manager: "kunal", pay: "good", tags: ["website", "e-commerce"] },
  { key: "nexora", company: "Nexora Infotech Solutions Pvt Ltd", sector: "IT & Services", source: "Website", city: "Hinjewadi", contact: "Aditya Rao", designation: "CEO", phone: "+91 96231 40987", email: "aditya@nexorainfotech.com", gstin: "27AAHCN6610B1ZQ", manager: "sneha", pay: "tds", tags: ["retainer", "TDS"] },
  { key: "suraksha", company: "Suraksha Insurance Advisors", sector: "Finance & Insurance", source: "Referral", city: "Akurdi", contact: "Prakash Bhosale", designation: "Proprietor", phone: "+91 94221 38865", email: "prakash@surakshaadvisors.in", gstin: null, manager: "priya", pay: "good", tags: [] },
  { key: "anjali", company: "Dr. Anjali Kulkarni", sector: "Personal Brand", source: "Instagram", city: "Kothrud", contact: "Dr. Anjali Kulkarni", designation: "Nutritionist", phone: "+91 98500 64419", email: "hello@dranjalikulkarni.com", gstin: null, manager: "rohan", pay: "good", tags: ["personal brand", "reels"] },
  { key: "vertex", company: "Vertex Industrial Supplies", sector: "Manufacturing & Industrial (MIDC)", source: "Google", city: "Bengaluru", state: "Karnataka", stateCode: "29", contact: "Kiran Hegde", designation: "GM – Sales", phone: "+91 80410 22598", email: "kiran@vertexindustrial.co.in", gstin: "29AAFCV2231H1Z6", manager: "amit", pay: "good", tags: ["inter-state", "SEO"] },
  { key: "shreeganesh", company: "Shree Ganesh Precision Engineering", sector: "Manufacturing & Industrial (MIDC)", source: "Referral", city: "Bhosari MIDC", contact: "Ganesh Lande", designation: "Managing Partner", phone: "+91 98221 90534", email: "info@shreeganeshprecision.com", gstin: "27AAKFS3349E1ZB", manager: "amit", pay: "good", tags: ["website", "SEO"] },
  { key: "deccan", company: "Deccan Agro Equipments", sector: "Manufacturing & Industrial (MIDC)", source: "Cold call", city: "Talegaon", contact: "Sunil Gaikwad", designation: "Owner", phone: "+91 97639 11208", email: "deccanagro@gmail.com", gstin: "27ACZPG4410L1Z9", manager: "kunal", pay: "good", tags: ["one-time"], status: "INACTIVE" as const },
] as const;
type ClientKey = (typeof CLIENTS)[number]["key"];

type Pkg = Partial<Record<ContentFormat, number>>;
type PS = { slug: string; sub?: string; desc: string; rate: number; qty?: number; billing?: "MONTHLY_RETAINER" | "MILESTONE" | "ONE_TIME"; pkg?: Pkg };
type ProjDef = {
  key: string;
  client: ClientKey;
  name: string;
  startOffset: number; // days from today (negative = past)
  retainerMonths?: number;
  deadlineOffset?: number;
  completed?: boolean;
  services: PS[];
  manager: EmpKey;
  adsBudget?: number;
  adsPace?: number;
  troubled?: boolean; // more overdue work
};

const PROJECTS: ProjDef[] = [
  { key: "kalyani-sm", client: "kalyani", name: "Kalyani Auto – Social & Meta Ads", startOffset: -240, retainerMonths: 12, manager: "priya",
    services: [
      { slug: "social-media", desc: "Social media management – LinkedIn, Instagram, Facebook", rate: 25000, pkg: { STATIC_POST: 12, REEL: 4 } },
      { slug: "meta-ads", desc: "Meta Ads management fee (ad budget billed by Meta)", rate: 15000 },
    ], adsBudget: 60000, adsPace: 0.85 },
  { key: "pristine-ads", client: "pristine", name: "Pristine Heights – Lead Gen & Content", startOffset: -300, retainerMonths: 12, manager: "sneha",
    services: [
      { slug: "meta-ads", desc: "Meta Ads management – project launch campaigns", rate: 20000 },
      { slug: "reels-posts", sub: "Monthly Package", desc: "Content package: 12 posts + 8 reels / month", rate: 35000, pkg: { STATIC_POST: 12, REEL: 8 } },
    ], adsBudget: 150000, adsPace: 1.12 },
  { key: "sahyadri-sm", client: "sahyadri", name: "Sahyadri Smile – Social & Local SEO", startOffset: -163, retainerMonths: 6, manager: "priya",
    services: [
      { slug: "social-media", desc: "Social media management – Instagram & Facebook", rate: 18000, pkg: { STATIC_POST: 10, REEL: 4 } },
      { slug: "seo", sub: "Local SEO / Google Business Profile", desc: "Local SEO & Google Business Profile", rate: 15000 },
    ] },
  { key: "brightpath-ads", client: "brightpath", name: "BrightPath – Admissions Campaign", startOffset: -150, retainerMonths: 12, manager: "sneha",
    services: [
      { slug: "meta-ads", desc: "Meta Ads management – admissions lead generation", rate: 12000 },
      { slug: "social-media", desc: "Social media management – Instagram & Facebook", rate: 15000, pkg: { STATIC_POST: 8, REEL: 4 } },
    ], adsBudget: 45000, adsPace: 0.9 },
  { key: "rasoi-reels", client: "rasoi", name: "Rasoi Ghar – Reels & Posts", startOffset: -122, retainerMonths: 12, manager: "rohan",
    services: [{ slug: "reels-posts", sub: "Monthly Package", desc: "Content package: 8 posts + 6 reels / month", rate: 22000, pkg: { STATIC_POST: 8, REEL: 6 } }] },
  { key: "nexora-dm", client: "nexora", name: "Nexora – Digital Marketing & SEO", startOffset: -360, retainerMonths: 12, manager: "sneha",
    services: [
      { slug: "digital-marketing", desc: "Digital marketing – strategy, Google Ads, email campaigns", rate: 30000 },
      { slug: "seo", desc: "SEO – technical, on-page & backlinks", rate: 20000 },
    ] },
  { key: "suraksha-sm", client: "suraksha", name: "Suraksha – Social Media", startOffset: -92, retainerMonths: 6, manager: "priya",
    services: [{ slug: "social-media", desc: "Social media management – Facebook & Instagram", rate: 12000, pkg: { STATIC_POST: 8 } }] },
  { key: "anjali-reels", client: "anjali", name: "Dr. Anjali – Personal Brand Reels", startOffset: -60, retainerMonths: 6, manager: "rohan",
    services: [{ slug: "reels-posts", sub: "Monthly Package", desc: "10 reels / month – scripting, shoot support & editing", rate: 18000, pkg: { REEL: 10 } }] },
  { key: "vertex-seo", client: "vertex", name: "Vertex Industrial – SEO", startOffset: -212, retainerMonths: 12, manager: "amit",
    services: [{ slug: "seo", desc: "SEO – B2B industrial keywords (pan-India)", rate: 22000 }] },
  { key: "urban-web", client: "urbanthreads", name: "UrbanThreads – WooCommerce Store", startOffset: -50, deadlineOffset: 25, manager: "kunal", troubled: true,
    services: [
      { slug: "web-dev", sub: "WooCommerce Store", desc: "WooCommerce store – 120 products, Razorpay, Shiprocket", rate: 180000, billing: "MILESTONE" },
    ] },
  { key: "urban-ads", client: "urbanthreads", name: "UrbanThreads – Meta Ads", startOffset: -45, retainerMonths: 6, manager: "sneha",
    services: [{ slug: "meta-ads", desc: "Meta Ads management – catalogue & sales campaigns", rate: 10000 }], adsBudget: 40000, adsPace: 0.8 },
  { key: "sg-web", client: "shreeganesh", name: "Shree Ganesh – Company Website", startOffset: -150, deadlineOffset: -110, completed: true, manager: "kunal",
    services: [{ slug: "web-dev", sub: "WordPress Website", desc: "WordPress corporate website – 12 pages", rate: 65000, billing: "MILESTONE" }] },
  { key: "sg-seo", client: "shreeganesh", name: "Shree Ganesh – SEO Retainer", startOffset: -118, retainerMonths: 12, manager: "amit", troubled: true,
    services: [{ slug: "seo", desc: "SEO – CNC machining & job work keywords", rate: 12000 }] },
  { key: "deccan-design", client: "deccan", name: "Deccan Agro – Brand Identity & Brochure", startOffset: -340, deadlineOffset: -315, completed: true, manager: "rohan",
    services: [
      { slug: "design-video", sub: "Logo & Brand Identity", desc: "Logo & brand identity", rate: 15000, billing: "ONE_TIME" },
      { slug: "design-video", sub: "Brochure / Catalogue", desc: "8-page product brochure", rate: 12000, billing: "ONE_TIME" },
    ] },
];

const TOPICS = [
  "Festive offer announcement", "Behind the scenes", "Customer testimonial", "Product spotlight", "Team introduction",
  "Tips & tricks", "Before / after", "FAQ answered", "Myth vs fact", "Weekend special", "Process walkthrough",
  "Founder's message", "Client success story", "Quick tutorial", "Trending audio reel", "Milestone celebration",
];

// ── main ─────────────────────────────────────────────────────────────────────
export async function seedSampleData(db: PrismaClient, adminId: string) {
  const settings = await db.settings.findUniqueOrThrow({ where: { id: "agency" } });
  const depts = Object.fromEntries((await db.department.findMany()).map((x) => [x.name, x.id]));
  const sectors = Object.fromEntries((await db.sector.findMany()).map((x) => [x.name, x.id]));
  const sources = Object.fromEntries((await db.leadSource.findMany()).map((x) => [x.name, x.id]));
  const services = await db.service.findMany({ include: { subServices: true } });
  const svc = Object.fromEntries(services.map((s) => [s.slug, s]));
  const onboardingTpl = await db.onboardingTemplateItem.findMany({ orderBy: { sortOrder: "asc" } });

  // ── employees ──
  const passwordHash = await bcrypt.hash("Employee@123", 10);
  const emp: Record<EmpKey, string> = {} as Record<EmpKey, string>;
  for (const e of EMPLOYEES) {
    const u = await db.user.create({
      data: {
        name: e.name,
        email: e.email,
        passwordHash,
        role: "EMPLOYEE",
        employee: {
          create: {
            phone: e.phone,
            departmentId: depts[e.dept],
            designation: e.designation,
            joiningDate: d(-randInt(200, 900)),
            hourlyCost: e.cost,
          },
        },
      },
    });
    emp[e.key] = u.id;
  }

  // ── clients ──
  const client: Record<ClientKey, { id: string; stateCode: string; country: string; pay: PayBehaviour; contact: string }> =
    {} as never;
  for (const [i, c] of CLIENTS.entries()) {
    const stateCode = "stateCode" in c ? c.stateCode : "27";
    const row = await db.client.create({
      data: {
        companyName: c.company,
        phone: c.phone,
        whatsapp: c.phone,
        email: c.email,
        website: c.email.includes("gmail") ? null : `https://${c.email.split("@")[1]}`,
        sectorId: sectors[c.sector],
        city: c.city,
        state: "state" in c ? c.state : "Maharashtra",
        stateCode,
        billingAddress: `${c.city}, ${"state" in c ? c.state : "Maharashtra"}`,
        gstin: c.gstin,
        pan: c.gstin ? c.gstin.slice(2, 12) : null,
        leadSourceId: sources[c.source],
        accountManagerId: emp[c.manager as EmpKey],
        tags: [...c.tags],
        status: "status" in c ? c.status : "ACTIVE",
        createdById: adminId,
        createdAt: at(k(-370 + i * 9)),
        contacts: {
          create: [
            { name: c.contact, designation: c.designation, phone: c.phone, whatsapp: c.phone, email: c.email, isPrimary: true },
          ],
        },
      },
    });
    client[c.key] = { id: row.id, stateCode, country: "India", pay: c.pay as PayBehaviour, contact: c.contact };
  }

  const taxModeFor = (ck: ClientKey): TaxMode =>
    determineTaxMode({ gstEnabled: true, agencyStateCode: settings.stateCode, clientStateCode: client[ck].stateCode, clientCountry: client[ck].country });

  // ── offers (accepted ones per project are created with the projects) ──
  const offerQueue: { date: string; create: (number: string) => Promise<string> }[] = [];

  function offerItemsFrom(list: PS[], months?: number): (LineInput & Prisma.OfferItemCreateWithoutOfferInput)[] {
    return list.map((ps, i) => {
      const s = svc[ps.slug];
      const sub = ps.sub ? s.subServices.find((x) => x.name === ps.sub) : undefined;
      return {
        service: { connect: { id: s.id } },
        subService: sub ? { connect: { id: sub.id } } : undefined,
        description: ps.desc,
        billingType: ps.billing ?? "MONTHLY_RETAINER",
        quantity: ps.qty ?? 1,
        unit: ps.billing && ps.billing !== "MONTHLY_RETAINER" ? "project" : "month",
        rate: ps.rate,
        gstRate: 18,
        durationMonths: ps.billing && ps.billing !== "MONTHLY_RETAINER" ? null : months ?? null,
        deliverables: ps.pkg ? Object.entries(ps.pkg).map(([format, qtyPerMonth]) => ({ format, qtyPerMonth })) : undefined,
        sortOrder: i,
      };
    });
  }

  function queueOffer(o: {
    date: string;
    clientKey?: ClientKey;
    leadId?: string;
    title: string;
    status: OfferStatus;
    items: PS[];
    months?: number;
    validDays?: number;
    followUp?: string | null;
    rejectReason?: string;
    acceptedAt?: Date;
    acceptedBy?: string;
    onCreated?: (id: string) => void;
  }) {
    offerQueue.push({
      date: o.date,
      create: async (number) => {
        const mode = o.clientKey ? taxModeFor(o.clientKey) : "INTRA_STATE";
        const items = offerItemsFrom(o.items, o.months);
        const totals = computeTotals(items, mode);
        const history: Prisma.OfferStatusHistoryCreateWithoutOfferInput[] = [
          { toStatus: "DRAFT", createdAt: at(o.date, 10), changedBy: { connect: { id: adminId } } },
        ];
        if (o.status !== "DRAFT") history.push({ fromStatus: "DRAFT", toStatus: "SENT", createdAt: at(o.date, 12), changedBy: { connect: { id: adminId } } });
        if (o.status === "ON_HOLD") history.push({ fromStatus: "SENT", toStatus: "ON_HOLD", note: "Client asked to revisit after budget approval", createdAt: at(addDaysKey(o.date, 4)), changedBy: { connect: { id: adminId } } });
        if (o.status === "ACCEPTED") history.push({ fromStatus: "SENT", toStatus: "ACCEPTED", changedVia: "public_link", note: `Accepted by ${o.acceptedBy}`, createdAt: o.acceptedAt! });
        if (o.status === "REJECTED") history.push({ fromStatus: "SENT", toStatus: "REJECTED", note: o.rejectReason, createdAt: at(addDaysKey(o.date, 6)), changedBy: { connect: { id: adminId } } });
        if (o.status === "EXPIRED") history.push({ fromStatus: "SENT", toStatus: "EXPIRED", changedVia: "system", createdAt: at(addDaysKey(o.date, (o.validDays ?? 15) + 1), 0) });

        const created = await db.offer.create({
          data: {
            number,
            client: o.clientKey ? { connect: { id: client[o.clientKey].id } } : undefined,
            lead: o.leadId ? { connect: { id: o.leadId } } : undefined,
            title: o.title,
            status: o.status,
            offerDate: keyToDate(o.date),
            validUntil: keyToDate(addDaysKey(o.date, o.validDays ?? 15)),
            followUpDate: o.followUp ? keyToDate(o.followUp) : null,
            durationMonths: o.months,
            paymentTerms: o.items.some((x) => x.billing === "MILESTONE") ? "50% advance, 30% after design approval, 20% before launch" : "Monthly in advance, due within 15 days of invoice",
            terms: settings.quotationTerms,
            rejectReason: o.rejectReason,
            subtotal: money(totals.subtotal),
            discountTotal: money(totals.discountTotal),
            taxableTotal: money(totals.taxableTotal),
            taxTotal: money(totals.taxTotal),
            grandTotal: money(totals.grandTotal),
            acceptedAt: o.acceptedAt,
            acceptedByName: o.acceptedBy,
            acceptedIp: o.acceptedAt ? "49.36.112.18" : null,
            createdById: adminId,
            createdAt: at(o.date, 10),
            items: {
              create: items.map((it, i) => ({
                ...it,
                quantity: String(it.quantity),
                rate: String(it.rate),
                taxableValue: money(totals.lines[i].taxable),
              })),
            },
            versions: o.status !== "DRAFT" ? { create: [{ version: 1, snapshot: { items: o.items, totals: money(totals.grandTotal) }, createdById: adminId, createdAt: at(o.date, 12) }] } : undefined,
            statusHistory: { create: history },
          },
        });
        o.onCreated?.(created.id);
        return created.id;
      },
    });
  }

  // ── leads ──
  const LEADS: {
    contact: string; company: string; sector: string; source: string; city: string; stage: Prisma.LeadCreateInput["stage"];
    budget?: number; follow?: number | null; services: string[]; created: number; notes: string; lost?: string; convertTo?: ClientKey;
    offer?: { status: OfferStatus; title: string; items: PS[]; date: number; validDays?: number; follow?: number | null; reject?: string; months?: number };
  }[] = [
    { contact: "Yogesh Gawade", company: "Moraya Builders", sector: "Real Estate & Construction", source: "Instagram", city: "Chinchwad", stage: "NEW", budget: 50000, follow: 0, services: ["meta-ads", "reels-posts"], created: -1, notes: "New 2BHK project launch in Ravet. Wants site-visit leads." },
    { contact: "Akash Thorat", company: "FitZone Gym", sector: "Other", source: "Instagram", city: "Wakad", stage: "NEW", budget: 20000, follow: 1, services: ["social-media", "reels-posts"], created: -2, notes: "Gym membership promotions, reels with trainers." },
    { contact: "Dr. Swati Naik", company: "Aarogya Diagnostics", sector: "Healthcare & Clinics", source: "Google", city: "Pimpri", stage: "NEW", budget: 30000, follow: null, services: ["seo", "social-media"], created: 0, notes: "Enquiry from website form – health packages." },
    { contact: "Mahesh Gupta", company: "Sai Krupa Hardware", sector: "Retail & E-commerce", source: "Walk-in", city: "Bhosari", stage: "CONTACTED", budget: 15000, follow: -2, services: ["social-media"], created: -9, notes: "Walk-in. Wants Google Business Profile + Instagram." },
    { contact: "Rajesh Iyer", company: "Precision Tools India", sector: "Manufacturing & Industrial (MIDC)", source: "LinkedIn", city: "Chakan MIDC", stage: "CONTACTED", budget: 80000, follow: 2, services: ["web-dev", "seo"], created: -12, notes: "Needs new website + export-market SEO." },
    { contact: "Pooja Sawant", company: "Little Champs Preschool", sector: "Education & Coaching", source: "Facebook", city: "Moshi", stage: "CONTACTED", budget: 25000, follow: 0, services: ["meta-ads"], created: -6, notes: "Admission season campaign from January." },
    { contact: "Omkar Bhosale", company: "Omkar Motors", sector: "Automobile & Auto Components", source: "Referral", city: "Pimpri", stage: "REQUIREMENT_DISCUSSED", budget: 40000, follow: 3, services: ["social-media", "meta-ads"], created: -15, notes: "Two-wheeler dealership. Test-ride leads.",
      offer: { status: "DRAFT", title: "Social Media + Meta Ads – Omkar Motors", date: -1, items: [{ slug: "social-media", desc: "Social media management", rate: 18000, pkg: { STATIC_POST: 10, REEL: 4 } }, { slug: "meta-ads", desc: "Meta Ads management", rate: 12000 }], months: 6 } },
    { contact: "Nikhil Desai", company: "Green Valley Resorts", sector: "Hospitality & Restaurants", source: "Website", city: "Lonavala", stage: "REQUIREMENT_DISCUSSED", budget: 60000, follow: -5, services: ["reels-posts", "meta-ads"], created: -45, notes: "Weekend packages. Went quiet after offer.",
      offer: { status: "EXPIRED", title: "Reels & Meta Ads – Green Valley Resorts", date: -38, validDays: 15, items: [{ slug: "reels-posts", sub: "Monthly Package", desc: "8 reels + 8 posts / month", rate: 30000, pkg: { REEL: 8, STATIC_POST: 8 } }, { slug: "meta-ads", desc: "Meta Ads management", rate: 15000 }], months: 6 } },
    { contact: "Kavita Rane", company: "CloudNine Interiors", sector: "Real Estate & Construction", source: "Instagram", city: "Baner", stage: "REQUIREMENT_DISCUSSED", budget: 35000, follow: 1, services: ["reels-posts", "design-video"], created: -10, notes: "Portfolio reels of completed interiors." },
    { contact: "Sachin Soni", company: "Mahalaxmi Jewellers", sector: "Retail & E-commerce", source: "WhatsApp", city: "Chinchwad", stage: "OFFER_SENT", budget: 50000, follow: 0, services: ["social-media", "meta-ads", "reels-posts"], created: -14, notes: "Wedding season campaign.",
      offer: { status: "SENT", title: "Wedding Season Campaign – Mahalaxmi Jewellers", date: -5, validDays: 15, follow: 0, items: [{ slug: "social-media", desc: "Social media management", rate: 20000, pkg: { STATIC_POST: 12, REEL: 6 } }, { slug: "meta-ads", desc: "Meta Ads management", rate: 15000 }], months: 3 } },
    { contact: "Varun Kapoor", company: "TechNova Systems", sector: "IT & Services", source: "LinkedIn", city: "Hinjewadi", stage: "OFFER_SENT", budget: 120000, follow: 3, services: ["web-dev"], created: -25, notes: "HRMS portal on Next.js.",
      offer: { status: "ON_HOLD", title: "HRMS Web App – TechNova Systems", date: -18, validDays: 30, follow: 3, items: [{ slug: "web-dev", sub: "Next.js / MERN Web App", desc: "HRMS web app – attendance, leave, payroll export", rate: 240000, billing: "MILESTONE" }] } },
    { contact: "Dr. Vivek Mane", company: "Shivneri Multispeciality Hospital", sector: "Healthcare & Clinics", source: "Google", city: "Narhe", stage: "OFFER_SENT", budget: 45000, follow: 1, services: ["seo", "social-media"], created: -20, notes: "Expiring soon – call before validity ends.",
      offer: { status: "SENT", title: "SEO + Social – Shivneri Hospital", date: -13, validDays: 15, follow: 1, items: [{ slug: "seo", desc: "SEO – local & specialty keywords", rate: 18000 }, { slug: "social-media", desc: "Social media management", rate: 16000, pkg: { STATIC_POST: 10, REEL: 2 } }], months: 6 } },
    { contact: "Dr. Anjali Kulkarni", company: "Dr. Anjali Kulkarni", sector: "Personal Brand", source: "Instagram", city: "Kothrud", stage: "WON", services: ["reels-posts"], created: -75, notes: "Nutritionist – personal brand reels.", convertTo: "anjali" },
    { contact: "Prakash Bhosale", company: "Suraksha Insurance Advisors", sector: "Finance & Insurance", source: "Referral", city: "Akurdi", stage: "WON", services: ["social-media"], created: -105, notes: "Referred by Kalyani Auto.", convertTo: "suraksha" },
    { contact: "Imran Shaikh", company: "Royal Caterers", sector: "Hospitality & Restaurants", source: "Facebook", city: "Pimple Saudagar", stage: "LOST", follow: null, services: ["social-media"], created: -40, notes: "Price sensitive.", lost: "Budget constraints – went with a freelancer",
      offer: { status: "REJECTED", title: "Social Media – Royal Caterers", date: -32, items: [{ slug: "social-media", desc: "Social media management", rate: 15000, pkg: { STATIC_POST: 8, REEL: 2 } }], months: 6, reject: "Budget constraints – went with a freelancer" } },
  ];

  for (const l of LEADS) {
    const lead = await db.lead.create({
      data: {
        contactName: l.contact,
        companyName: l.company,
        phone: `+91 9${randInt(100000000, 999999999)}`,
        sectorId: sectors[l.sector],
        city: l.city,
        leadSourceId: sources[l.source],
        servicesInterested: l.services.map((s) => svc[s].id),
        approxBudget: l.budget,
        requirementNotes: l.notes,
        stage: l.stage,
        lostReason: l.lost,
        nextFollowUpDate: l.follow === null || l.follow === undefined ? null : d(l.follow),
        ownerId: adminId,
        convertedClientId: l.convertTo ? client[l.convertTo].id : null,
        convertedAt: l.convertTo ? at(k(l.created + 12)) : null,
        createdById: adminId,
        createdAt: at(k(l.created), 10),
      },
    });
    if (l.offer) {
      queueOffer({
        date: k(l.offer.date),
        leadId: lead.id,
        title: l.offer.title,
        status: l.offer.status,
        items: l.offer.items,
        months: l.offer.months,
        validDays: l.offer.validDays,
        followUp: l.offer.follow === undefined || l.offer.follow === null ? null : k(l.offer.follow),
        rejectReason: l.offer.reject,
      });
    }
  }

  // client upsell offers
  queueOffer({ date: k(-8), clientKey: "suraksha", title: "SEO add-on – Suraksha Insurance Advisors", status: "SENT", followUp: k(-1),
    items: [{ slug: "seo", sub: "Local SEO / Google Business Profile", desc: "Local SEO & Google Business Profile", rate: 10000 }], months: 6 });
  queueOffer({ date: k(-6), clientKey: "kalyani", title: "Corporate video – Kalyani Auto", status: "ACCEPTED", acceptedAt: at(T, 10), acceptedBy: "Sanjay Kalyani",
    items: [{ slug: "design-video", sub: "Video Shoot", desc: "Corporate plant video – 1 day shoot + 2 min edit", rate: 45000, billing: "ONE_TIME" }] });

  // ── projects ──
  type ProjRow = { id: string; def: ProjDef; startKey: string; endKey: string | null; offerItemsMode: TaxMode };
  const projects: ProjRow[] = [];
  let projSeq = 1;

  for (const p of PROJECTS) {
    const startKey = k(p.startOffset);
    const isRetainer = !!p.retainerMonths;
    const endKey = isRetainer ? addDaysKey(dateOnlyKey(addMonths(keyToDate(startKey), p.retainerMonths!)), -1) : null;
    const mode = taxModeFor(p.client);
    const clientRow = CLIENTS.find((c) => c.key === p.client)!;

    let offerId = "";
    queueOffer({
      date: addDaysKey(startKey, -7),
      clientKey: p.client,
      title: p.name,
      status: "ACCEPTED",
      items: p.services,
      months: p.retainerMonths,
      acceptedAt: at(addDaysKey(startKey, -3), 16),
      acceptedBy: clientRow.contact,
      onCreated: (id) => (offerId = id),
    });
    // offers are created later in date order; create project after flushing
    projects.push({ id: "", def: p, startKey, endKey, offerItemsMode: mode });
    void offerId;
  }

  // flush offers in date order so QT numbers are chronological
  offerQueue.sort((a, b) => a.date.localeCompare(b.date));
  const offerIdByProject = new Map<string, string>();
  for (const q of offerQueue) {
    const number = await db.$transaction((tx) => nextDocNumber(tx, "QUOTATION", q.date));
    const id = await q.create(number);
    const offer = await db.offer.findUniqueOrThrow({ where: { id } });
    const proj = PROJECTS.find((p) => p.name === offer.title && offer.status === "ACCEPTED");
    if (proj) offerIdByProject.set(proj.key, id);
  }

  for (const pr of projects) {
    const p = pr.def;
    const isRetainer = !!p.retainerMonths;
    const row = await db.project.create({
      data: {
        code: `PRJ-${String(projSeq++).padStart(4, "0")}`,
        name: p.name,
        clientId: client[p.client].id,
        offerId: offerIdByProject.get(p.key),
        managerId: emp[p.manager],
        status: p.completed ? "COMPLETED" : "ACTIVE",
        startDate: keyToDate(pr.startKey),
        deadline: p.deadlineOffset !== undefined ? d(p.deadlineOffset) : null,
        isRetainer,
        retainerStart: isRetainer ? keyToDate(pr.startKey) : null,
        retainerEnd: pr.endKey ? keyToDate(pr.endKey) : null,
        autoRenew: isRetainer && rand() > 0.5,
        createdById: adminId,
        createdAt: at(pr.startKey, 9),
        services: {
          create: p.services.map((ps) => ({
            serviceId: svc[ps.slug].id,
            description: ps.desc,
            billingType: ps.billing ?? "MONTHLY_RETAINER",
            quantity: ps.qty ?? 1,
            rate: ps.rate,
            gstRate: 18,
            monthlyValue: (ps.billing ?? "MONTHLY_RETAINER") === "MONTHLY_RETAINER" ? ps.rate * (ps.qty ?? 1) : 0,
            deliverables: ps.pkg ? Object.entries(ps.pkg).map(([format, qtyPerMonth]) => ({ format, qtyPerMonth })) : undefined,
          })),
        },
      },
    });
    pr.id = row.id;

    // onboarding checklist
    const slugs = new Set(p.services.map((s) => s.slug));
    const titles = Array.from(
      new Set(onboardingTpl.filter((t) => !t.serviceId || services.some((s) => s.id === t.serviceId && slugs.has(s.slug))).map((t) => t.title)),
    );
    const ageDays = -p.startOffset;
    await db.onboardingChecklist.create({
      data: {
        clientId: client[p.client].id,
        projectId: row.id,
        items: {
          create: titles.map((title, i) => {
            const done = ageDays > 70 || i < Math.ceil(titles.length * (ageDays > 55 ? 0.7 : 0.5));
            return { title, isDone: done, doneAt: done ? at(addDaysKey(pr.startKey, i + 1)) : null, doneById: done ? adminId : null, sortOrder: i };
          }),
        },
      },
    });
  }
  const projByKey = Object.fromEntries(projects.map((p) => [p.def.key, p]));

  // ── milestones ──
  async function milestones(projKey: string, list: { name: string; due: number; status: "COMPLETED" | "IN_PROGRESS" | "PENDING"; pct?: number; total: number }[]) {
    const out: Record<string, string> = {};
    for (const [i, m] of list.entries()) {
      const row = await db.milestone.create({
        data: {
          projectId: projByKey[projKey].id,
          name: m.name,
          dueDate: d(m.due),
          status: m.status,
          completedAt: m.status === "COMPLETED" ? at(k(m.due - 1)) : null,
          paymentPercent: m.pct,
          amount: m.pct ? (m.total * m.pct) / 100 : null,
          sortOrder: i,
        },
      });
      out[m.name] = row.id;
    }
    return out;
  }
  const urbanMs = await milestones("urban-web", [
    { name: "Requirements & Specs", due: -44, status: "COMPLETED", pct: 50, total: 180000 },
    { name: "UI/UX Design", due: -28, status: "COMPLETED", pct: 30, total: 180000 },
    { name: "Development", due: 5, status: "IN_PROGRESS", total: 180000 },
    { name: "Testing", due: 16, status: "PENDING", total: 180000 },
    { name: "Launch", due: 25, status: "PENDING", pct: 20, total: 180000 },
  ]);
  const sgMs = await milestones("sg-web", [
    { name: "Requirements & Specs", due: -145, status: "COMPLETED", pct: 50, total: 65000 },
    { name: "UI/UX Design", due: -135, status: "COMPLETED", pct: 30, total: 65000 },
    { name: "Development", due: -120, status: "COMPLETED", total: 65000 },
    { name: "Launch", due: -111, status: "COMPLETED", pct: 20, total: 65000 },
  ]);

  // ── tasks, deliverables, content calendar ──
  const doneTasks: { id: string; userId: string; due: string }[] = [];
  const statusForDue = (due: string, troubled: boolean): { status: TaskStatus; completedKey?: string; changed?: string } => {
    if (due < T) {
      const r = rand();
      const overdueChance = troubled ? 0.35 : 0.03;
      if (r < overdueChance) return { status: pick(["IN_PROGRESS", "TODO", "IN_PROGRESS", "BLOCKED"] as const), changed: addDaysKey(due, -1) };
      const late = rand() < 0.18;
      const completedKey = minKey(late ? addDaysKey(due, randInt(1, 3)) : addDaysKey(due, -randInt(0, 2)), T);
      return { status: "DONE", completedKey };
    }
    if (due === T) return { status: pick(["IN_PROGRESS", "TODO", "IN_REVIEW"] as const), changed: k(-1) };
    const days = daysBetweenKeys(T, due);
    if (days <= 3) {
      const s = pick(["IN_PROGRESS", "IN_REVIEW", "WAITING_CLIENT_APPROVAL", "TODO"] as const);
      return { status: s, changed: s === "WAITING_CLIENT_APPROVAL" ? k(-randInt(1, 4)) : k(-1) };
    }
    return { status: rand() < 0.2 ? "IN_PROGRESS" : "TODO", changed: k(-2) };
  };

  async function makeTask(o: {
    projKey: string; title: string; slug: string; due: string; start?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    milestoneId?: string; deliverableId?: string; forced?: { status: TaskStatus; completedKey?: string; changed?: string }; assignee?: EmpKey;
  }) {
    const pr = projByKey[o.projKey];
    const owner = o.assignee ?? SERVICE_OWNER[o.slug];
    const st = o.forced ?? statusForDue(o.due, !!pr.def.troubled);
    const task = await db.task.create({
      data: {
        title: o.title,
        projectId: pr.id,
        clientId: client[pr.def.client].id,
        serviceId: svc[o.slug].id,
        milestoneId: o.milestoneId,
        deliverableId: o.deliverableId,
        assigneeId: emp[owner],
        departmentId: depts[EMPLOYEES.find((e) => e.key === owner)!.dept],
        priority: o.priority ?? (rand() < 0.15 ? "HIGH" : "MEDIUM"),
        status: st.status,
        startDate: keyToDate(o.start ?? addDaysKey(o.due, -randInt(2, 5))),
        dueDate: keyToDate(o.due),
        completedAt: st.completedKey ? at(st.completedKey, randInt(11, 19)) : null,
        statusChangedAt: at(st.completedKey ?? st.changed ?? k(-1), 12),
        blockedReason: st.status === "BLOCKED" ? "Waiting for product photos from client" : null,
        revisionCount: rand() < 0.2 ? randInt(1, 3) : 0,
        createdById: adminId,
        createdAt: at(addDaysKey(o.due, -10), 9),
      },
    });
    if (st.status === "DONE") doneTasks.push({ id: task.id, userId: emp[owner], due: o.due });
    return { task, st };
  }

  const PLATFORMS = ["INSTAGRAM", "FACEBOOK"] as const;
  for (const pr of projects) {
    const p = pr.def;
    if (!p.retainerMonths) continue;
    const months = [shiftMonth(CUR, -1), CUR].filter((m) => m >= pr.startKey.slice(0, 7));
    for (const month of months) {
      const { start, end } = monthRange(`${month}-01`);
      const span = daysBetweenKeys(start, end);
      for (const ps of p.services) {
        // package deliverables
        for (const [format, qty] of Object.entries(ps.pkg ?? {}) as [ContentFormat, number][]) {
          for (let i = 1; i <= qty; i++) {
            const due = addDaysKey(start, Math.min(span, Math.round(2 + ((span - 4) * i) / qty)));
            const label = format === "REEL" ? "Reel" : format === "STATIC_POST" ? "Post" : format;
            const deliverable = await db.deliverable.create({
              data: { projectId: pr.id, serviceId: svc[ps.slug].id, format, title: `${label} #${i} – ${formatMonthKey(month)}`, month, dueDate: keyToDate(due), revisionsIncluded: 2 },
            });
            const owner: EmpKey = format === "REEL" || ps.slug === "reels-posts" ? "rohan" : "priya";
            const { st } = await makeTask({
              projKey: p.key, slug: ps.slug, due, deliverableId: deliverable.id, assignee: owner,
              title: `${label} #${i} – ${formatMonthKey(month)}: ${format === "REEL" ? "script, shoot & edit" : "design & caption"}`,
            });
            if (st.status === "DONE") {
              await db.deliverable.update({ where: { id: deliverable.id }, data: { deliveredAt: at(st.completedKey!, 18), revisionsUsed: randInt(0, 2) } });
            }
            const approved = st.status === "DONE" || (st.status === "IN_REVIEW" && rand() < 0.5);
            await db.contentCalendarItem.create({
              data: {
                clientId: client[p.client].id,
                projectId: pr.id,
                deliverableId: deliverable.id,
                platforms: p.client === "kalyani" ? ["LINKEDIN", ...PLATFORMS] : [...PLATFORMS],
                format,
                topic: pick(TOPICS),
                caption: "Caption draft – to be finalised after approval ✨",
                designStatus: st.status === "DONE" ? "READY" : st.status === "TODO" ? "NOT_STARTED" : "IN_PROGRESS",
                approvalStatus: approved ? "APPROVED" : st.status === "WAITING_CLIENT_APPROVAL" ? "PENDING" : rand() < 0.15 ? "CHANGES_REQUESTED" : "PENDING",
                publishDate: keyToDate(due),
                publishedAt: st.status === "DONE" ? at(st.completedKey!, 19) : null,
                publishedLink: st.status === "DONE" ? `https://www.instagram.com/p/${Math.random().toString(36).slice(2, 13)}/` : null,
                month,
              },
            });
          }
        }
        // recurring service tasks
        if (ps.slug === "meta-ads") {
          for (let w = 1; w <= 4; w++) {
            const due = addDaysKey(start, Math.min(span, w * 7));
            const deliverable = await db.deliverable.create({ data: { projectId: pr.id, serviceId: svc["meta-ads"].id, title: `Weekly ads report W${w} – ${formatMonthKey(month)}`, month, dueDate: keyToDate(due) } });
            const { st } = await makeTask({ projKey: p.key, slug: "meta-ads", due, deliverableId: deliverable.id, title: `Weekly ads report – week ${w}` });
            if (st.status === "DONE") await db.deliverable.update({ where: { id: deliverable.id }, data: { deliveredAt: at(st.completedKey!, 18) } });
          }
          await makeTask({ projKey: p.key, slug: "meta-ads", due: addDaysKey(start, 10), title: "Campaign optimisation – audiences & creatives" });
        }
        if (ps.slug === "seo") {
          await makeTask({ projKey: p.key, slug: "seo", due: addDaysKey(start, 8), title: "On-page optimisation – priority pages" });
          await makeTask({ projKey: p.key, slug: "seo", due: addDaysKey(start, 18), title: "Off-page – 15 quality backlinks" });
          const deliverable = await db.deliverable.create({ data: { projectId: pr.id, serviceId: svc.seo.id, title: `Monthly ranking report – ${formatMonthKey(month)}`, month, dueDate: keyToDate(addDaysKey(start, Math.min(span, 27))) } });
          const { st } = await makeTask({ projKey: p.key, slug: "seo", due: addDaysKey(start, Math.min(span, 27)), deliverableId: deliverable.id, title: "Monthly ranking report", priority: "HIGH" });
          if (st.status === "DONE") await db.deliverable.update({ where: { id: deliverable.id }, data: { deliveredAt: at(st.completedKey!, 18) } });
        }
        if (ps.slug === "digital-marketing") {
          await makeTask({ projKey: p.key, slug: "digital-marketing", due: addDaysKey(start, 5), title: "Google Ads – search campaign review" });
          await makeTask({ projKey: p.key, slug: "digital-marketing", due: addDaysKey(start, 15), title: "Email newsletter – product update" });
          await makeTask({ projKey: p.key, slug: "digital-marketing", due: addDaysKey(start, Math.min(span, 28)), title: "Monthly performance report", priority: "HIGH" });
        }
        if (ps.slug === "social-media") {
          await makeTask({ projKey: p.key, slug: "social-media", due: addDaysKey(start, Math.min(span, 25)), title: `Content calendar for ${formatMonthKey(shiftMonth(month, 1))}`, priority: "HIGH" });
        }
      }
    }
  }

  // a few hand-crafted alerts so every panel has something real
  await makeTask({ projKey: "pristine-ads", slug: "reels-posts", due: k(-4), title: "Site-visit reel – Tower B sample flat", assignee: "rohan", priority: "HIGH", forced: { status: "WAITING_CLIENT_APPROVAL", changed: k(-4) } });
  await makeTask({ projKey: "nexora-dm", slug: "digital-marketing", due: k(-3), title: "Landing page copy for ERP webinar", priority: "URGENT", forced: { status: "WAITING_CLIENT_APPROVAL", changed: k(-3) } });
  await makeTask({ projKey: "sg-seo", slug: "seo", due: k(-6), title: "Fix 42 crawl errors from Search Console", priority: "HIGH", forced: { status: "IN_PROGRESS", changed: k(-7) } });
  await makeTask({ projKey: "sg-seo", slug: "seo", due: k(-2), title: "GBP – add 20 product photos", forced: { status: "BLOCKED", changed: k(-3) } });
  await makeTask({ projKey: "brightpath-ads", slug: "meta-ads", due: T, title: "Launch Diwali batch admissions campaign", priority: "URGENT", forced: { status: "IN_PROGRESS", changed: k(-1) } });
  await makeTask({ projKey: "kalyani-sm", slug: "social-media", due: T, title: "LinkedIn post – IATF certification", forced: { status: "IN_REVIEW", changed: k(-1) } });

  // website project tasks per milestone
  const webTasks: [string, string, number, string?][] = [
    ["Requirements & Specs", "Requirement workshop & sitemap", -46],
    ["Requirements & Specs", "Product catalogue structure (categories, variants)", -44],
    ["UI/UX Design", "Homepage & PLP design", -34],
    ["UI/UX Design", "Product page & checkout design", -29],
    ["Development", "Theme setup & header/footer", -12],
    ["Development", "Razorpay & Shiprocket integration", -3, "IN_PROGRESS"],
    ["Development", "Product upload – 120 SKUs", -1, "BLOCKED"],
    ["Development", "Size guide & filters", 4],
    ["Testing", "Cross-browser & mobile testing", 14],
    ["Testing", "Payment test transactions", 15],
    ["Launch", "Go-live & DNS switch", 25],
  ];
  for (const [m, title, due, force] of webTasks) {
    await makeTask({
      projKey: "urban-web", slug: "web-dev", due: k(due), title, milestoneId: urbanMs[m], priority: m === "Launch" ? "URGENT" : "MEDIUM",
      forced: due < 0 && !force ? { status: "DONE", completedKey: k(due - randInt(0, 1)) } : force ? { status: force as TaskStatus, changed: k(due - 1) } : undefined,
      assignee: m === "UI/UX Design" ? "rohan" : "kunal",
    });
  }
  for (const [m, title, due] of [
    ["Requirements & Specs", "Requirement workshop", -147],
    ["UI/UX Design", "Website design – 12 pages", -136],
    ["Development", "WordPress development", -121],
    ["Launch", "Go-live", -111],
  ] as const) {
    await makeTask({ projKey: "sg-web", slug: "web-dev", due: k(due), title, milestoneId: sgMs[m], forced: { status: "DONE", completedKey: k(due) } });
  }
  for (const [title, due] of [["Logo concepts (3 options)", -335], ["Brand guidelines", -328], ["Brochure design – 8 pages", -318]] as const) {
    await makeTask({ projKey: "deccan-design", slug: "design-video", due: k(due), title, forced: { status: "DONE", completedKey: k(due + 1) } });
  }

  // time logs on completed tasks (for profitability)
  for (const t of doneTasks) {
    await db.timeLog.create({ data: { taskId: t.id, userId: t.userId, date: keyToDate(minKey(t.due, T)), minutes: pick([45, 60, 90, 120, 150, 180, 240]) } });
  }

  // ── project health & progress ──
  for (const pr of projects) {
    // Retainers: progress = % of tasks due in the last 30 days that are done. Others: % of all tasks done.
    const where: Prisma.TaskWhereInput = { projectId: pr.id, archivedAt: null, ...(pr.def.retainerMonths ? { dueDate: { gte: d(-30), lte: d(0) } } : {}) };
    const [total, done, open, overdue] = await Promise.all([
      db.task.count({ where }),
      db.task.count({ where: { ...where, status: "DONE" } }),
      db.task.count({ where: { projectId: pr.id, status: { not: "DONE" } } }),
      // waiting on the client is not the agency's delay → excluded from overdue
      db.task.count({ where: { projectId: pr.id, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: keyToDate(T) } } }),
    ]);
    const missed = await db.milestone.count({ where: { projectId: pr.id, status: { not: "COMPLETED" }, dueDate: { lt: keyToDate(T) } } });
    const soon = await db.milestone.count({ where: { projectId: pr.id, status: { not: "COMPLETED" }, dueDate: { gte: keyToDate(T), lte: d(7) } } });
    const progress = pr.def.completed ? 100 : total ? Math.round((done / total) * 100) : 0;
    const health = computeProjectHealth({
      todayKey: T, openTasks: open, overdueTasks: overdue, missedMilestones: missed, milestonesDueSoon: soon,
      deadlineKey: pr.def.deadlineOffset !== undefined ? k(pr.def.deadlineOffset) : pr.endKey, progressPercent: progress, isCompleted: pr.def.completed,
    });
    await db.project.update({ where: { id: pr.id }, data: { progressPercent: progress, healthAuto: health } });
  }

  // ── targets & progress ──
  const TARGETS: Record<string, { metric: string; unit: string; target: number; base: number; growth: number; higher?: boolean }[]> = {
    "kalyani-sm": [{ metric: "LinkedIn followers", unit: "count", target: 5000, base: 3600, growth: 180 }, { metric: "Leads", unit: "count", target: 40, base: 28, growth: 3 }],
    "pristine-ads": [{ metric: "Leads", unit: "count", target: 300, base: 240, growth: 18 }, { metric: "CPL", unit: "₹", target: 450, base: 560, growth: -25, higher: false }],
    "sahyadri-sm": [{ metric: "Instagram followers", unit: "count", target: 3000, base: 1900, growth: 210 }, { metric: "GBP calls", unit: "count", target: 120, base: 70, growth: 12 }],
    "brightpath-ads": [{ metric: "Admission enquiries", unit: "count", target: 150, base: 95, growth: 12 }, { metric: "CPL", unit: "₹", target: 300, base: 380, growth: -15, higher: false }],
    "nexora-dm": [{ metric: "Organic traffic", unit: "count", target: 8000, base: 5200, growth: 450 }, { metric: "Keywords in top 10", unit: "count", target: 40, base: 22, growth: 4 }],
    "vertex-seo": [{ metric: "Keywords in top 10", unit: "count", target: 30, base: 14, growth: 3 }, { metric: "Organic enquiries", unit: "count", target: 25, base: 11, growth: 2 }],
    "sg-seo": [{ metric: "Keywords in top 10", unit: "count", target: 20, base: 4, growth: 1 }],
    "rasoi-reels": [{ metric: "Reels delivered", unit: "count", target: 6, base: 5, growth: 0 }],
    "anjali-reels": [{ metric: "Instagram followers", unit: "count", target: 25000, base: 15800, growth: 2100 }],
  };
  for (const [pk, list] of Object.entries(TARGETS)) {
    for (const [i, t] of list.entries()) {
      const target = await db.target.create({
        data: { projectId: projByKey[pk].id, metric: t.metric, unit: t.unit, targetValue: t.target, higherIsBetter: t.higher ?? true, sortOrder: i },
      });
      for (let m = 3; m >= 1; m--) {
        const month = shiftMonth(CUR, -m);
        if (month < projByKey[pk].startKey.slice(0, 7)) continue;
        const value = Math.max(0, Math.round(t.base + t.growth * (3 - m) + (rand() - 0.5) * Math.abs(t.growth)));
        await db.targetProgress.create({ data: { targetId: target.id, month, actualValue: value } });
      }
    }
  }

  // ── Meta Ads campaigns & spend (client budget — NOT our revenue) ──
  for (const pr of projects.filter((x) => x.def.adsBudget)) {
    const p = pr.def;
    const periods = [
      { start: -54, end: -25, status: "COMPLETED" as const, pace: 0.95, suffix: "Phase 1" },
      { start: -24, end: 5, status: "ACTIVE" as const, pace: p.adsPace ?? 0.9, suffix: "Phase 2" },
    ].filter((x) => x.start >= p.startOffset);
    for (const per of periods) {
      const camp = await db.adCampaign.create({
        data: {
          clientId: client[p.client].id, projectId: pr.id, name: `${p.client === "urbanthreads" ? "Catalogue Sales" : "Lead Generation"} – ${per.suffix}`,
          objective: p.client === "urbanthreads" ? "Sales" : "Leads", status: per.status, startDate: d(per.start), endDate: d(per.end), plannedBudget: p.adsBudget!,
        },
      });
      const days = per.end - per.start + 1;
      for (let s = per.start; s <= Math.min(per.end, -1); s += 7) {
        const e = Math.min(s + 6, per.end, -1);
        const spend = Math.round(((p.adsBudget! / days) * (e - s + 1) * per.pace * (0.92 + rand() * 0.16)) * 100) / 100;
        const impressions = Math.round(spend * (45 + rand() * 30));
        const clicks = Math.round(impressions * (0.011 + rand() * 0.01));
        const leads = Math.round(clicks * (0.05 + rand() * 0.06));
        await db.adSpendEntry.create({
          data: {
            campaignId: camp.id, periodStart: d(s), periodEnd: d(e), spend: spend.toFixed(2), impressions, clicks,
            leads: p.client === "urbanthreads" ? 0 : leads, conversionValue: p.client === "urbanthreads" ? (spend * (2.6 + rand())).toFixed(2) : 0,
          },
        });
      }
    }
  }

  // ── domains & hosting ──
  const ASSETS: { c: ClientKey; kind: "DOMAIN" | "HOSTING" | "SSL" | "BUSINESS_EMAIL"; name: string; provider: string; plan?: string; exp: number; cost: number; price: number; emails?: number }[] = [
    { c: "urbanthreads", kind: "DOMAIN", name: "urbanthreads.in", provider: "GoDaddy", exp: 7, cost: 799, price: 1200 },
    { c: "sahyadri", kind: "HOSTING", name: "sahyadrismile.com", provider: "Hostinger", plan: "Business Shared", exp: 15, cost: 3600, price: 6000 },
    { c: "shreeganesh", kind: "SSL", name: "shreeganeshprecision.com", provider: "Sectigo", exp: 30, cost: 1500, price: 2500 },
    { c: "deccan", kind: "DOMAIN", name: "deccanagro.co.in", provider: "BigRock", exp: 1, cost: 650, price: 1200 },
    { c: "shreeganesh", kind: "HOSTING", name: "shreeganeshprecision.com", provider: "Hostinger", plan: "Premium", exp: 64, cost: 4200, price: 7200 },
    { c: "nexora", kind: "DOMAIN", name: "nexorainfotech.com", provider: "Namecheap", exp: 122, cost: 1100, price: 1500 },
    { c: "kalyani", kind: "BUSINESS_EMAIL", name: "kalyaniauto.in – 10 mailboxes", provider: "Google Workspace", plan: "Business Starter", exp: 205, cost: 13800, price: 18000, emails: 10 },
    { c: "suraksha", kind: "DOMAIN", name: "surakshaadvisors.in", provider: "GoDaddy", exp: 280, cost: 799, price: 1200 },
  ];
  const assetIds: Record<string, string> = {};
  for (const a of ASSETS) {
    const row = await db.domainHostingAsset.create({
      data: {
        clientId: client[a.c].id, kind: a.kind, name: a.name, provider: a.provider, plan: a.plan, purchaseDate: keyToDate(addDaysKey(k(a.exp), -365)),
        expiryDate: d(a.exp), emailAccounts: a.emails, costPrice: a.cost, renewalPrice: a.price, autoRenew: a.exp > 100,
        credentialsLocation: "Agency password manager → Clients / " + a.name.split(" ")[0],
      },
    });
    assetIds[a.name + a.kind] = row.id;
  }

  // ── invoices ──
  type InvSpec = {
    clientKey: ClientKey; projKey?: string; type: "TAX" | "PROFORMA"; date: string; dueDays?: number; draft?: boolean;
    source: Prisma.InvoiceCreateInput["source"]; retainerMonth?: string; milestoneId?: string; assetId?: string;
    lines: { desc: string; slug?: string; rate: number; qty?: number }[];
  };
  const invSpecs: InvSpec[] = [];
  for (const pr of projects.filter((x) => x.def.retainerMonths)) {
    const p = pr.def;
    let month = pr.startKey.slice(0, 7);
    while (month <= CUR) {
      const date = maxKey(`${month}-01`, pr.startKey);
      if (date > T) break;
      invSpecs.push({
        clientKey: p.client, projKey: p.key, type: "TAX", date, source: "RETAINER_MONTH", retainerMonth: month,
        draft: month === CUR && (p.key === "suraksha-sm" || p.key === "anjali-reels"),
        lines: p.services.map((s) => ({ desc: `${s.desc} – ${formatMonthKey(month)}`, slug: s.slug, rate: s.rate })),
      });
      month = shiftMonth(month, 1);
    }
  }
  invSpecs.push(
    { clientKey: "urbanthreads", projKey: "urban-web", type: "TAX", date: k(-49), source: "MILESTONE", milestoneId: urbanMs["Requirements & Specs"], lines: [{ desc: "WooCommerce store – 50% advance (Requirements & Specs)", slug: "web-dev", rate: 90000 }] },
    { clientKey: "urbanthreads", projKey: "urban-web", type: "PROFORMA", date: k(-5), dueDays: 7, source: "MILESTONE", milestoneId: urbanMs["UI/UX Design"], lines: [{ desc: "WooCommerce store – 30% on design approval", slug: "web-dev", rate: 54000 }] },
    { clientKey: "shreeganesh", projKey: "sg-web", type: "TAX", date: k(-150), source: "MILESTONE", milestoneId: sgMs["Requirements & Specs"], lines: [{ desc: "Company website – 50% advance", slug: "web-dev", rate: 32500 }] },
    { clientKey: "shreeganesh", projKey: "sg-web", type: "TAX", date: k(-135), source: "MILESTONE", milestoneId: sgMs["UI/UX Design"], lines: [{ desc: "Company website – 30% on design approval", slug: "web-dev", rate: 19500 }] },
    { clientKey: "shreeganesh", projKey: "sg-web", type: "TAX", date: k(-111), source: "MILESTONE", milestoneId: sgMs["Launch"], lines: [{ desc: "Company website – 20% on launch", slug: "web-dev", rate: 13000 }] },
    { clientKey: "deccan", projKey: "deccan-design", type: "TAX", date: k(-315), source: "PROJECT", lines: [{ desc: "Logo & brand identity", slug: "design-video", rate: 15000 }, { desc: "8-page product brochure", slug: "design-video", rate: 12000 }] },
    { clientKey: "deccan", type: "TAX", date: k(-300), source: "RENEWAL", lines: [{ desc: "Hosting renewal – deccanagro.co.in (1 year)", slug: "domain-hosting", rate: 6000 }] },
    { clientKey: "shreeganesh", type: "TAX", date: k(-20), source: "RENEWAL", lines: [{ desc: "Domain renewal – shreeganeshprecision.com", slug: "domain-hosting", rate: 1200 }] },
    { clientKey: "urbanthreads", type: "TAX", date: k(-2), draft: true, source: "RENEWAL", assetId: assetIds["urbanthreads.inDOMAIN"], lines: [{ desc: "Domain renewal – urbanthreads.in (1 year)", slug: "domain-hosting", rate: 1200 }] },
  );
  invSpecs.sort((a, b) => a.date.localeCompare(b.date));

  const issued: { id: string; clientKey: ClientKey; projKey?: string; date: string; due: string; grand: string; taxable: string; index: number }[] = [];
  for (const spec of invSpecs) {
    const mode = taxModeFor(spec.clientKey);
    const lines: LineInput[] = spec.lines.map((l) => ({ quantity: l.qty ?? 1, rate: l.rate, gstRate: 18 }));
    const t = computeTotals(lines, mode);
    const due = addDaysKey(spec.date, spec.dueDays ?? settings.defaultPaymentTermsDays);
    const c = CLIENTS.find((x) => x.key === spec.clientKey)!;
    const pos = `${"state" in c ? c.state : "Maharashtra"} (${client[spec.clientKey].stateCode})`;
    const created = await db.$transaction(async (tx) => {
      const number = spec.draft ? null : await nextDocNumber(tx, spec.type === "TAX" ? "INVOICE" : "PROFORMA", spec.date);
      return tx.invoice.create({
        data: {
          number, type: spec.type, status: spec.draft ? "DRAFT" : "ISSUED", source: spec.source, clientId: client[spec.clientKey].id,
          projectId: spec.projKey ? projByKey[spec.projKey].id : null, milestoneId: spec.milestoneId, assetId: spec.assetId, retainerMonth: spec.retainerMonth,
          invoiceDate: keyToDate(spec.date), dueDate: keyToDate(due), placeOfSupply: pos, taxMode: mode,
          clientSnapshot: spec.draft ? undefined : { companyName: c.company, gstin: c.gstin, state: pos },
          agencySnapshot: spec.draft ? undefined : { name: settings.agencyName, gstin: settings.gstin, state: `${settings.state} (${settings.stateCode})` },
          subtotal: money(t.subtotal), discountTotal: money(t.discountTotal), taxableTotal: money(t.taxableTotal), cgstTotal: money(t.cgstTotal),
          sgstTotal: money(t.sgstTotal), igstTotal: money(t.igstTotal), roundOff: money(t.roundOff), grandTotal: money(t.grandTotal),
          amountInWords: amountInWords(t.grandTotal), balanceDue: money(t.grandTotal), terms: settings.invoiceTerms,
          issuedAt: spec.draft ? null : at(spec.date, 10), issuedById: spec.draft ? null : adminId, createdById: adminId, createdAt: at(spec.date, 9),
          items: {
            create: spec.lines.map((l, i) => ({
              serviceId: l.slug ? svc[l.slug].id : null, description: l.desc, sacCode: svc[l.slug ?? ""]?.sacCode ?? null, quantity: l.qty ?? 1, unit: "month",
              rate: l.rate, taxableValue: money(t.lines[i].taxable), gstRate: 18, cgstAmount: money(t.lines[i].cgst), sgstAmount: money(t.lines[i].sgst),
              igstAmount: money(t.lines[i].igst), lineTotal: money(t.lines[i].total), sortOrder: i,
            })),
          },
        },
      });
    });
    if (!spec.draft && spec.type === "TAX") {
      issued.push({ id: created.id, clientKey: spec.clientKey, projKey: spec.projKey, date: spec.date, due, grand: money(t.grandTotal), taxable: money(t.taxableTotal), index: issued.length });
    }
  }

  // credit note on a Kalyani invoice from 2 months ago (missed deliverables discount)
  const kalyaniInvoices = issued.filter((i) => i.projKey === "kalyani-sm");
  const cnTarget = kalyaniInvoices[kalyaniInvoices.length - 3];
  const credits: Record<string, string> = {};
  if (cnTarget) {
    const cnDate = addDaysKey(cnTarget.date, 10);
    const cnTotals = computeTotals([{ quantity: 1, rate: 5000, gstRate: 18 }], "INTRA_STATE", { roundToRupee: false });
    await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, "CREDIT_NOTE", cnDate);
      await tx.creditNote.create({
        data: {
          number, invoiceId: cnTarget.id, clientId: client.kalyani.id, date: keyToDate(cnDate), reason: "Discount for 2 posts not delivered in the month",
          taxableAmount: "5000.00", cgstAmount: money(cnTotals.cgstTotal), sgstAmount: money(cnTotals.sgstTotal), totalAmount: money(cnTotals.grandTotal), createdById: adminId,
        },
      });
    });
    credits[cnTarget.id] = money(cnTotals.grandTotal);
  }

  // ── payments ──
  const MODES: PaymentMode[] = ["BANK_TRANSFER", "UPI", "BANK_TRANSFER", "CHEQUE", "UPI"];
  async function pay(clientKey: ClientKey, date: string, allocations: { invoiceId: string; amount: string; tds?: string }[], tdsSection?: string) {
    if (date > T) return;
    const amount = allocations.reduce((s, a) => s.plus(a.amount), toDecimal(0));
    const tds = allocations.reduce((s, a) => s.plus(a.tds ?? 0), toDecimal(0));
    await db.payment.create({
      data: {
        clientId: client[clientKey].id, date: keyToDate(date), amount: money(amount), tdsAmount: money(tds), tdsSection: tds.greaterThan(0) ? tdsSection : null,
        mode: pick(MODES), reference: `UTR${randInt(100000000, 999999999)}`, createdById: adminId, createdAt: at(date, 15),
        allocations: { create: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount, tdsAmount: a.tds ?? "0" })) },
      },
    });
  }

  const byClient = new Map<ClientKey, typeof issued>();
  for (const inv of issued) byClient.set(inv.clientKey, [...(byClient.get(inv.clientKey) ?? []), inv]);
  for (const [ck, list] of byClient) {
    const behaviour = client[ck].pay;
    for (const [i, inv] of list.entries()) {
      const isLast = i === list.length - 1;
      const isSecondLast = i === list.length - 2;
      const credit = toDecimal(credits[inv.id] ?? 0);
      const payable = toDecimal(inv.grand).minus(credit);
      if (inv.due > T && isLast && inv.date >= `${CUR}-01`) continue; // current month: not yet paid
      if (behaviour === "late" && i >= list.length - 3) continue; // BrightPath: last three unpaid → 31–60 & 0–30 overdue
      if (ck === "deccan" && i === list.length - 1) continue; // inactive client still owes hosting renewal → 90+ bucket
      if (behaviour === "partial" && isSecondLast) {
        await pay(ck, addDaysKey(inv.due, 5), [{ invoiceId: inv.id, amount: money(payable.dividedBy(2).toDecimalPlaces(0)) }]);
        continue;
      }
      if (behaviour === "partial" && isLast) continue;
      if (behaviour === "combined" && i % 2 === 0 && list[i + 1] && list[i + 1].due <= T) {
        const next = list[i + 1];
        await pay(ck, addDaysKey(next.due, -2), [
          { invoiceId: inv.id, amount: money(payable) },
          { invoiceId: next.id, amount: money(toDecimal(next.grand).minus(toDecimal(credits[next.id] ?? 0))) },
        ]);
        continue;
      }
      if (behaviour === "combined" && i % 2 === 1) continue; // paid together with previous
      if (behaviour === "tds") {
        const tds = toDecimal(inv.taxable).times(0.1).toDecimalPlaces(0);
        await pay(ck, addDaysKey(inv.due, randInt(-3, 6)), [{ invoiceId: inv.id, amount: money(payable.minus(tds)), tds: money(tds) }], "194J");
        continue;
      }
      await pay(ck, minKey(addDaysKey(inv.due, randInt(-6, 4)), T), [{ invoiceId: inv.id, amount: money(payable) }]);
    }
  }
  // unallocated advance from Dr. Anjali
  await db.payment.create({
    data: { clientId: client.anjali.id, date: d(-1), amount: "10000.00", mode: "UPI", reference: "UPI/AXIS/882910", notes: "Advance for next month", createdById: adminId },
  });

  // recompute invoice caches (paid, TDS, credited, balance, payment status)
  const allInvoices = await db.invoice.findMany({ include: { allocations: { include: { payment: true } }, creditNotes: true } });
  for (const inv of allInvoices) {
    const paid = inv.allocations.reduce((s, a) => s.plus(a.amount.toString()), toDecimal(0));
    const tds = inv.allocations.reduce((s, a) => s.plus(a.tdsAmount.toString()), toDecimal(0));
    const credited = inv.creditNotes.reduce((s, c) => s.plus(c.totalAmount.toString()), toDecimal(0));
    const balance = invoiceBalance({ grandTotal: inv.grandTotal, amountPaid: paid, tdsTotal: tds, creditedTotal: credited });
    const status =
      inv.status === "DRAFT"
        ? "UNPAID"
        : computePaymentStatus({
            status: inv.status, grandTotal: inv.grandTotal, amountPaid: paid, tdsTotal: tds, creditedTotal: credited,
            dueDateKey: inv.dueDate.toISOString().slice(0, 10), todayKey: T,
          });
    await db.invoice.update({
      where: { id: inv.id },
      data: { amountPaid: money(paid), tdsTotal: money(tds), creditedTotal: money(credited), balanceDue: money(balance), paymentStatus: status },
    });
  }

  // ── expenses ──
  const EXP: { cat: ExpenseCategory; desc: string; vendor: string; amount: number; gst: number; monthly?: boolean; projKey?: string; months?: number }[] = [
    { cat: "SOFTWARE_TOOLS", desc: "Canva Pro – team", vendor: "Canva", amount: 3999, gst: 720, monthly: true },
    { cat: "SOFTWARE_TOOLS", desc: "Adobe Creative Cloud", vendor: "Adobe", amount: 4230, gst: 761, monthly: true },
    { cat: "SOFTWARE_TOOLS", desc: "SEMrush Guru", vendor: "Semrush", amount: 9800, gst: 0, monthly: true },
    { cat: "FREELANCER", desc: "Freelance videographer – site shoots", vendor: "Sagar Films", amount: 8000, gst: 0, monthly: true, projKey: "pristine-ads", months: 6 },
    { cat: "FREELANCER", desc: "Freelance model – reels", vendor: "Talent agency", amount: 3500, gst: 0, monthly: true, projKey: "anjali-reels", months: 2 },
    { cat: "TRAVEL", desc: "Client visits – fuel & cab", vendor: "Various", amount: 1800, gst: 0, monthly: true },
  ];
  for (const e of EXP) {
    for (let m = 0; m < (e.months ?? 12); m++) {
      const month = shiftMonth(CUR, -m);
      const date = minKey(`${month}-0${randInt(3, 9)}`, T);
      if (date > T) continue;
      await db.expense.create({
        data: {
          date: keyToDate(date), category: e.cat, description: e.desc, vendor: e.vendor, amount: e.amount, gstPaid: e.gst,
          projectId: e.projKey ? projByKey[e.projKey].id : null, clientId: e.projKey ? client[projByKey[e.projKey].def.client].id : null, createdById: adminId,
        },
      });
    }
  }
  const ONE_OFF: { cat: ExpenseCategory; desc: string; amount: number; gst: number; days: number; projKey?: string; ck?: ClientKey }[] = [
    { cat: "DOMAIN_HOSTING", desc: "Hosting renewal – deccanagro.co.in", amount: 3600, gst: 648, days: -300, ck: "deccan" },
    { cat: "DOMAIN_HOSTING", desc: "Domain renewal – shreeganeshprecision.com", amount: 799, gst: 144, days: -20, ck: "shreeganesh" },
    { cat: "STOCK_ASSETS", desc: "Envato Elements – product mockups", amount: 1450, gst: 261, days: -38, projKey: "urban-web" },
    { cat: "STOCK_ASSETS", desc: "Stock footage – industrial", amount: 2200, gst: 396, days: -70, projKey: "kalyani-sm" },
    { cat: "PRINTING", desc: "Brochure print proofs", amount: 2600, gst: 468, days: -318, projKey: "deccan-design" },
    { cat: "OTHER", desc: "Studio lights & mic", amount: 8900, gst: 1602, days: -95 },
    { cat: "SOFTWARE_TOOLS", desc: "WooCommerce premium plugins", amount: 6200, gst: 1116, days: -14, projKey: "urban-web" },
  ];
  for (const e of ONE_OFF) {
    await db.expense.create({
      data: {
        date: d(e.days), category: e.cat, description: e.desc, amount: e.amount, gstPaid: e.gst,
        projectId: e.projKey ? projByKey[e.projKey].id : null, clientId: e.ck ? client[e.ck].id : e.projKey ? client[projByKey[e.projKey].def.client].id : null, createdById: adminId,
      },
    });
  }

  // ── communication log ──
  const COMMS: { ck: ClientKey; type: "CALL" | "MEETING" | "WHATSAPP" | "EMAIL"; days: number; summary: string; next?: string; nextDays?: number }[] = [
    { ck: "brightpath", type: "CALL", days: -3, summary: "Reminded about 2 pending invoices. Rahul promised payment by Friday.", next: "Follow up on payment", nextDays: 1 },
    { ck: "urbanthreads", type: "MEETING", days: -5, summary: "Design sign-off meeting. Ritika approved all pages; product photos pending.", next: "Collect product photos", nextDays: 0 },
    { ck: "pristine", type: "WHATSAPP", days: -2, summary: "Shared Tower B reel draft for approval.", next: "Get reel approval", nextDays: 0 },
    { ck: "nexora", type: "EMAIL", days: -7, summary: "Sent quarterly SEO review deck." },
    { ck: "sahyadri", type: "CALL", days: -1, summary: "Discussed renewal of retainer ending this month. Positive.", next: "Send renewal offer", nextDays: 2 },
  ];
  for (const c of COMMS) {
    await db.communicationLog.create({
      data: { clientId: client[c.ck].id, type: c.type, date: at(k(c.days), 16), summary: c.summary, nextAction: c.next, nextActionDate: c.nextDays !== undefined ? d(c.nextDays) : null, createdById: adminId },
    });
  }

  // ── activity log (recent highlights) ──
  await db.activityLog.createMany({
    data: [
      { actorId: null, action: "offer.accepted", entityType: "Offer", entityId: offerIdByProject.get("urban-web") ?? "", clientId: client.urbanthreads.id, changes: { status: { from: "SENT", to: "ACCEPTED" } }, createdAt: at(k(-53), 16) },
      { actorId: adminId, action: "invoice.issued", entityType: "Invoice", entityId: issued[issued.length - 1]?.id ?? "", clientId: client[issued[issued.length - 1]?.clientKey ?? "kalyani"].id, createdAt: at(T, 10) },
    ],
  });
}

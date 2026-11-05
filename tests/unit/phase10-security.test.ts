import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { goLiveProblems, type GoLiveInput } from "@/lib/go-live";
import { can, NAV_PERMISSION, type Permission } from "@/lib/permissions";
import { clientIp } from "@/lib/rate-limit";
import { changePasswordSchema, passwordSchema, profileSchema } from "@/lib/validators/account";

const SRC = path.resolve(__dirname, "../../src");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rel = (f: string) => path.relative(SRC, f).replaceAll("\\", "/");

describe("every door has a lock", () => {
  // Signing in and answering a client link are for people with no account. Their own checks are tested separately.
  const PUBLIC_ACTIONS = ["loginAction", "logoutAction", "requestPasswordResetAction", "resetPasswordAction", "respondToContentAction", "acceptOfferAction", "requestChangesAction"];

  it("every server action checks permission, or is on the short public list", () => {
    const unguarded: string[] = [];
    for (const f of walk(path.join(SRC, "server/actions"))) {
      const parts = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").split(/^export async function /m).slice(1);
      for (const part of parts) {
        const name = part.match(/^\w+/)![0];
        const body = part.slice(0, part.search(/^}/m));
        if (!/runAction\(|assertPermission\(/.test(body) && !PUBLIC_ACTIONS.includes(name)) unguarded.push(`${rel(f)} ${name}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("every action file really is a server action file", () => {
    for (const f of walk(path.join(SRC, "server/actions"))) expect(fs.readFileSync(f, "utf8").startsWith('"use server"'), rel(f)).toBe(true);
  });

  it("every download or data address checks permission, a job secret, or a client link", () => {
    const allowedWithoutLogin = ["app/api/auth/[...nextauth]/route.ts"];
    const unguarded: string[] = [];
    for (const f of walk(path.join(SRC, "app")).filter((x) => x.endsWith("route.ts"))) {
      const name = rel(f);
      if (allowedWithoutLogin.includes(name)) continue;
      const s = fs.readFileSync(f, "utf8");
      const guarded = /assertPermission\(/.test(s) || /CRON_SECRET/.test(s) || /await auth\(\)/.test(s) || (name.startsWith("app/p/") && /rateLimit\(/.test(s));
      if (!guarded) unguarded.push(name);
    }
    expect(unguarded).toEqual([]);
  });

  it("every money page and report asks for permission first", () => {
    for (const area of ["invoices", "payments", "expenses", "reports", "renewals", "team", "settings", "leads", "offers"]) {
      for (const f of walk(path.join(SRC, "app/(app)", area)).filter((x) => x.endsWith("page.tsx"))) {
        expect(/requirePermission\(|requireUser\(/.test(fs.readFileSync(f, "utf8")) || area === "settings", rel(f)).toBe(true);
      }
    }
  });

  it("no raw HTML is written into a page", () => {
    const risky = walk(SRC).filter((f) => /\.tsx$/.test(f) && /dangerouslySetInnerHTML/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(risky).toEqual([]);
  });

  it("database queries are never built from pasted text", () => {
    const risky = walk(SRC).filter((f) => /\.tsx?$/.test(f) && /\$(query|execute)RawUnsafe/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(risky).toEqual([]);
  });

  it("no secrets are written into the code", () => {
    const found = walk(SRC).filter((f) => /\.tsx?$/.test(f) && /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?:\/\/\w+:\w{6,}@)/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(found).toEqual([]);
  });
});

describe("who can do what, from the brief", () => {
  const table: [Permission, boolean, boolean, boolean][] = [
    // permission, Admin, Manager, Employee
    ["dashboard.full", true, true, false],
    ["dashboard.profit", true, false, false],
    ["sales.manage", true, true, false],
    ["work.manage", true, true, false],
    ["work.own", true, true, true],
    ["finance.manage", true, false, false],
    ["reports.monthly", true, true, false],
    ["team.manage", true, false, false],
    ["settings.manage", true, false, false],
  ];
  it.each(table)("%s", (permission, admin, manager, employee) => {
    expect([can("ADMIN", permission), can("MANAGER", permission), can("EMPLOYEE", permission)]).toEqual([admin, manager, employee]);
  });
  it("no role means no access", () => {
    expect(can(null, "work.own")).toBe(false);
    expect(can(undefined, "work.own")).toBe(false);
  });
  it("an employee's menu has only their own work", () => {
    const seen = Object.entries(NAV_PERMISSION).filter(([, p]) => can("EMPLOYEE", p)).map(([k]) => k);
    expect(seen).toEqual(["dashboard", "projects", "tasks", "content"]);
  });
  it("a manager's menu has no money, team or settings, and reports only for the monthly one", () => {
    const seen = Object.entries(NAV_PERMISSION).filter(([, p]) => can("MANAGER", p)).map(([k]) => k);
    expect(seen).toEqual(["dashboard", "leads", "clients", "offers", "projects", "tasks", "content", "ads", "reports"]);
  });
});

describe("rate limits go by the visitor's real address", () => {
  it("our own proxy's address comes first", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("203.0.113.5");
  });
  it("a visitor can't dodge a limit by typing in a forwarded address", () => {
    const a = clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.5" }));
    const b = clientIp(new Headers({ "x-forwarded-for": "8.8.8.8, 203.0.113.5" }));
    expect(a).toBe("203.0.113.5");
    expect(b).toBe(a);
  });
  it("copes with one address, or none", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("passwords", () => {
  it("need 8 characters, a letter and a number", () => {
    expect(passwordSchema.safeParse("abc12345").success).toBe(true);
    expect(passwordSchema.safeParse("ab1").success).toBe(false);
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });
  it("changing one needs a match, and a new one", () => {
    const ok = { current: "old-pass-1", next: "new-pass-1", confirm: "new-pass-1" };
    expect(changePasswordSchema.safeParse(ok).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...ok, confirm: "other-pass-1" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, next: "old-pass-1", confirm: "old-pass-1" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, current: "" }).success).toBe(false);
  });
});

describe("my details", () => {
  it("cleans a blank phone, and refuses a bad one", () => {
    const p = { name: "Priya", phone: "", dailyDigest: true, emailOnTask: false };
    expect(profileSchema.parse(p).phone).toBeNull();
    expect(profileSchema.safeParse({ ...p, phone: "abc" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...p, name: "" }).success).toBe(false);
  });
  it("has no way to change a role or department", () => {
    const parsed = profileSchema.parse({ name: "Priya", phone: "", dailyDigest: true, emailOnTask: false, role: "ADMIN", departmentId: "x", hourlyCost: "1" });
    expect(Object.keys(parsed).sort()).toEqual(["dailyDigest", "emailOnTask", "name", "phone"]);
  });
});

const ready: GoLiveInput = {
  authSecret: "x9Y2k7Qp4Lm8Vb3Nc6Rt1Zw5Hs0Jd2Gf7Aa", appUrl: "https://app.rezonest.com", cronSecret: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", smtpHost: "smtp.example.com", storageDriver: "s3",
  defaultPasswordUsers: [], sampleDataPresent: false, gstin: "27ABCDE1234F1Z5", bankAccount: "1234", upiId: "x@y", invoiceTerms: "Terms", signatureKey: "k", servicesMissingSac: 0, lastBackupDay: "2026-11-05", today: "2026-11-05",
};
const musts = (over: Partial<GoLiveInput>) => goLiveProblems({ ...ready, ...over }).filter((i) => i.level === "must").map((i) => i.text).join(" ");
const shoulds = (over: Partial<GoLiveInput>) => goLiveProblems({ ...ready, ...over }).filter((i) => i.level === "should").map((i) => i.text).join(" ");

describe("go-live check", () => {
  it("passes when everything's ready", () => {
    expect(goLiveProblems(ready)).toEqual([]);
  });
  it("blocks what would cause real harm", () => {
    expect(musts({ authSecret: "short" })).toMatch(/AUTH_SECRET/);
    expect(musts({ authSecret: "change-me-please-this-is-the-default-value" })).toMatch(/AUTH_SECRET/);
    expect(musts({ appUrl: "http://localhost:3000" })).toMatch(/APP_URL/);
    expect(musts({ cronSecret: "" })).toMatch(/CRON_SECRET/);
    expect(musts({ smtpHost: "" })).toMatch(/SMTP/);
    expect(musts({ defaultPasswordUsers: ["a@b.c"] })).toMatch(/a@b\.c/);
    expect(musts({ sampleDataPresent: true })).toMatch(/wipe-sample/);
    expect(musts({ gstin: null })).toMatch(/GSTIN/);
  });
  it("mentions what's worth doing without blocking", () => {
    expect(shoulds({ storageDriver: "local" })).toMatch(/cloud storage/);
    expect(shoulds({ upiId: "" })).toMatch(/UPI/);
    expect(shoulds({ servicesMissingSac: 2 })).toMatch(/2 services/);
    expect(shoulds({ lastBackupDay: "2026-11-01" })).toMatch(/No backup/);
    expect(musts({ storageDriver: "local", upiId: "" })).toBe("");
  });
});

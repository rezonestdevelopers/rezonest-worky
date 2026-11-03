import { addDaysKey, daysBetweenKeys } from "@/lib/dates";

/** ISO weekday of a date key: Monday = 1 ... Sunday = 7. */
function isoWeekday(key: string): number {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWorkingDay(key: string, workingDays: number[]): boolean {
  return workingDays.includes(isoWeekday(key));
}

/** The date itself if it's a working day, otherwise the next one (or the previous one going backwards). */
export function toWorkingDay(key: string, workingDays: number[], direction: 1 | -1 = 1): string {
  if (!workingDays.length) return key;
  let k = key;
  for (let i = 0; i < 7 && !isWorkingDay(k, workingDays); i++) k = addDaysKey(k, direction);
  return k;
}

/** Moves by a number of working days. Holidays aren't known, only weekly days off. */
export function addWorkingDays(key: string, days: number, workingDays: number[]): string {
  const step = days < 0 ? -1 : 1;
  let k = toWorkingDay(key, workingDays, step as 1 | -1);
  for (let i = 0; i < Math.abs(days); i++) k = toWorkingDay(addDaysKey(k, step), workingDays, step as 1 | -1);
  return k;
}

export interface PlanStep {
  title: string;
  durationDays: number;
  departmentId: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  isClientApproval: boolean;
}
export interface PlannedTask extends PlanStep {
  startKey: string;
  dueKey: string;
}

/** Steps run one after another from a start date. A step of n days ends n - 1 working days after it starts. */
export function planForward(steps: PlanStep[], startKey: string, workingDays: number[]): PlannedTask[] {
  const out: PlannedTask[] = [];
  let cursor = toWorkingDay(startKey, workingDays);
  for (const step of steps) {
    const dueKey = addWorkingDays(cursor, Math.max(step.durationDays, 1) - 1, workingDays);
    out.push({ ...step, startKey: cursor, dueKey });
    cursor = addWorkingDays(dueKey, 1, workingDays);
  }
  return out;
}

/**
 * Steps planned backwards, so the last one lands on the due date (a reel is posted on its day).
 * Nothing starts before `earliestKey`: if there isn't room, the early steps share that first day.
 */
export function planBackward(steps: PlanStep[], dueKey: string, earliestKey: string, workingDays: number[]): PlannedTask[] {
  const floor = toWorkingDay(earliestKey, workingDays);
  const out: PlannedTask[] = [];
  let cursor = toWorkingDay(dueKey, workingDays, -1);
  if (cursor < floor) cursor = floor;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const due = cursor;
    let start = addWorkingDays(due, -(Math.max(step.durationDays, 1) - 1), workingDays);
    if (start < floor) start = floor;
    out.unshift({ ...step, startKey: start, dueKey: due });
    const previous = addWorkingDays(start, -1, workingDays);
    cursor = previous < floor ? floor : previous;
  }
  return out;
}

/** Spreads a number of items evenly across a period, on working days. The last lands near the end. */
export function spreadDates(fromKey: string, toKey: string, count: number, workingDays: number[]): string[] {
  const span = Math.max(daysBetweenKeys(fromKey, toKey), 0);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const offset = Math.round((span * i) / count);
    const key = toWorkingDay(addDaysKey(fromKey, offset), workingDays, -1);
    out.push(key < fromKey ? toWorkingDay(fromKey, workingDays) : key);
  }
  return out;
}

const FORMAT_TEMPLATE: Record<string, string> = { STATIC_POST: "Post", CAROUSEL: "Post", STORY: "Post", REEL: "Reel", VIDEO: "Design Job" };
const FORMAT_LABEL: Record<string, string> = { STATIC_POST: "Post", CAROUSEL: "Carousel", STORY: "Story", REEL: "Reel", VIDEO: "Video" };

export const templateNameForFormat = (format: string) => FORMAT_TEMPLATE[format] ?? null;
export const labelForFormat = (format: string) => FORMAT_LABEL[format] ?? format;

/** The team member names written as "@Priya" in a comment. Matches a first name or a joined full name. */
export function findMentions(body: string, users: { id: string; name: string }[]): string[] {
  const words = new Set((body.match(/@[\p{L}\p{N}_.-]+/gu) ?? []).map((m) => m.slice(1).toLowerCase().replace(/[.,]+$/, "")));
  return users
    .filter((u) => {
      const name = u.name.toLowerCase();
      return words.has(name.split(/\s+/)[0]) || words.has(name.replace(/\s+/g, ""));
    })
    .map((u) => u.id);
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "WAITING_CLIENT_APPROVAL" | "DONE" | "BLOCKED";
export const TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "WAITING_CLIENT_APPROVAL", "DONE", "BLOCKED"];

/** Any status can follow any other, because real work moves back and forth. Only Blocked needs a reason. */
export function taskStatusError(input: { from: TaskStatus; to: TaskStatus; blockedReason?: string | null }): string | null {
  if (input.from === input.to) return "The task is already in this status.";
  if (input.to === "BLOCKED" && (input.blockedReason?.trim().length ?? 0) < 3) return "Please say what's blocking this task.";
  return null;
}

/** Percentage of included revisions used. Going past what's included is when a change request is due. */
export function revisionsExceeded(used: number, included: number): boolean {
  return used > included;
}

/** Share of onboarding items done, as a whole percent. */
export function onboardingPercent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

/** The last day of a retainer of so many months: 3 Nov for 6 months ends on 2 May. A day the end month lacks moves to its last day. */
export function retainerEndKey(startKey: string, months: number): string {
  const [year, month, day] = startKey.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return addDaysKey(target.toISOString().slice(0, 10), -1);
}

/** How many times a per-unit item's tasks are repeated: one set per unit, up to a sensible limit. */
export function unitSets(billingType: string, quantity: string | number): number {
  if (billingType !== "PER_UNIT") return 1;
  return Math.min(Math.max(Math.floor(Number(quantity)), 1), 100);
}

/** A retainer auto-renews for the same length it ran before. */
export function renewedEnd(startKey: string, endKey: string): string {
  const days = daysBetweenKeys(startKey, endKey);
  return addDaysKey(endKey, days + 1);
}

export type Health = "ON_TRACK" | "AT_RISK" | "DELAYED";

export interface HealthInput {
  todayKey: string;
  /** Open (not Done) tasks of the project */
  openTasks: number;
  /** Open tasks whose due date is before today */
  overdueTasks: number;
  /** Milestones past due date and not completed */
  missedMilestones: number;
  /** Milestones due in the next 7 days and not completed */
  milestonesDueSoon: number;
  deadlineKey?: string | null;
  progressPercent: number;
  isCompleted?: boolean;
}

/**
 * Auto health (documented in docs/DECISIONS.md):
 *  DELAYED  – any missed milestone, OR deadline passed and not complete,
 *             OR ≥ 3 overdue tasks, OR ≥ 25% of open tasks overdue.
 *  AT_RISK  – any overdue task, OR deadline within 7 days with < 80% progress,
 *             OR a milestone due within 7 days with < 50% progress.
 *  ON_TRACK – otherwise.
 * A manual override (set on the project) always wins — see effectiveHealth.
 */
export function computeProjectHealth(i: HealthInput): Health {
  if (i.isCompleted) return "ON_TRACK";
  const deadlinePassed = !!i.deadlineKey && i.todayKey > i.deadlineKey;
  const overdueShare = i.openTasks > 0 ? i.overdueTasks / i.openTasks : 0;

  if (i.missedMilestones > 0 || deadlinePassed || i.overdueTasks >= 3 || overdueShare >= 0.25) {
    return "DELAYED";
  }

  let deadlineSoon = false;
  if (i.deadlineKey) {
    const days =
      (Date.parse(`${i.deadlineKey}T00:00:00Z`) - Date.parse(`${i.todayKey}T00:00:00Z`)) / 86_400_000;
    deadlineSoon = days >= 0 && days <= 7;
  }
  if (
    i.overdueTasks > 0 ||
    (deadlineSoon && i.progressPercent < 80) ||
    (i.milestonesDueSoon > 0 && i.progressPercent < 50)
  ) {
    return "AT_RISK";
  }
  return "ON_TRACK";
}

export function effectiveHealth(auto: Health, override?: Health | null): Health {
  return override ?? auto;
}

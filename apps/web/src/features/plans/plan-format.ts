import { PLAN_TYPE_LABELS, WEEKDAY_LABELS, type PlanDto } from '@gms/shared';

export function planDuration(plan: Pick<PlanDto, 'durationValue' | 'durationUnit'>) {
  const unit = plan.durationUnit === 'DAY' ? 'day' : 'month';
  return `${plan.durationValue} ${unit}${plan.durationValue === 1 ? '' : 's'}`;
}

/** "Every day", "Weekdays", or a list such as "Mon, Wed, Fri". */
export function planDays(days: number[] | null) {
  if (!days) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '6,7') return 'Weekends';
  return days.map((day) => WEEKDAY_LABELS[day]).join(', ');
}

export function planHours(plan: Pick<PlanDto, 'accessStartTime' | 'accessEndTime'>) {
  return plan.accessStartTime && plan.accessEndTime
    ? `${plan.accessStartTime}–${plan.accessEndTime}`
    : 'All opening hours';
}

export function planAccess(plan: PlanDto) {
  return `${planDays(plan.accessDays)} · ${planHours(plan)}`;
}

export const planTypeLabel = (plan: PlanDto) => PLAN_TYPE_LABELS[plan.planType];

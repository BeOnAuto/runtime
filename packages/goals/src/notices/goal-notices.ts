import type { GoalsHostParts } from '../engine/goals-host-parts.ts';
import { noStartsMade } from '../notice-limits/notice-day-limit.ts';
import { summariesDueOf } from '../summaries/summaries-due.ts';
import type { NoticePorts } from './notice-ledger.ts';
import { noticesOwedOf } from './notice-starts.ts';
import { noticesSeenOf } from './notices-seen.ts';

export interface GoalNoticePorts extends NoticePorts {
  readonly now: () => number;
  readonly mostADay?: number;
}

export function goalNoticesOf({ now, mostADay, ...ports }: GoalNoticePorts): GoalsHostParts {
  const starts = noStartsMade(mostADay);
  return {
    consumers: [noticesSeenOf(ports.ledger, now)],
    dueWork: [noticesOwedOf(ports, starts), summariesDueOf(ports, starts)],
    playbookOperations: [],
  };
}

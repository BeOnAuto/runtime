import { wiredKindOf, type WiredEntityKind } from '@on.auto/operations/entities';

import { countsWithGoalsIn } from '../goal-activity/goal-counts.ts';
import { setAsideOfGoals, type StandingSetAside } from '../goal-activity/goal-set-aside.ts';
import { tablesWithGoals } from '../goal-activity/goal-tables.ts';
import { activityOfPlaybooksToday } from './activity-of-playbooks.ts';
import { playbookActivityKind, type PlaybookActivityKind } from './playbook-activity.ts';

export function activityOfPlaybooksKeepingGoals(standing: StandingSetAside): PlaybookActivityKind {
  return playbookActivityKind({
    name: 'playbook_activity_with_goals',
    tables: tablesWithGoals,
    countsIn: countsWithGoalsIn,
    setAsideIn: setAsideOfGoals(standing),
  });
}

export function activityEntityKinds(standing: StandingSetAside): readonly WiredEntityKind[] {
  return [wiredKindOf(activityOfPlaybooksToday), wiredKindOf(activityOfPlaybooksKeepingGoals(standing))];
}

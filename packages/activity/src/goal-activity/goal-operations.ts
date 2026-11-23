import { defineHttpOperation } from '@on.auto/operations';

import { activityOfPlaybooksKeepingGoals } from '../entities/activity-kinds.ts';
import { activityStaleOn, listedBy } from '../operations/activity-listing.ts';
import { markedBy } from '../operations/mark-activity-seen.ts';
import { mostPlaybookChanges } from '../operations/playbook-register.ts';
import { itemOfAnyAddress } from '../positions/activity-addresses.ts';
import { countsWithGoalsFor } from './goal-counts.ts';
import { rowsServedWithGoals } from './goal-rows-served.ts';
import {
  ListActivityWithGoalsInputSchema,
  ListActivityWithGoalsOutputSchema,
  MarkActivitySeenWithGoalsInputSchema,
  MarkActivitySeenWithGoalsOutputSchema,
  kindsWithGoals,
} from './goal-schemas.ts';
import type { GoalsRead } from './goal-set-aside.ts';

export function activityOperationsKeepingGoals(goals: GoalsRead) {
  const playbooks = activityOfPlaybooksKeepingGoals(goals.setAside);
  const listActivity = defineHttpOperation('org', 'query', {
    name: 'list_activity',
    staleOn: activityStaleOn,
    title: 'List activity',
    description: [
      'Lists the activity of the playbooks of the org the caller may access, newest first:',
      'the requests that wait on an answer, the definitions whose latest run broke,',
      `the runs, definitions and playbooks that are new, the playbooks from the newest ${mostPlaybookChanges} changes of the org's register,`,
      'the verdicts of goals and the overdues their owner asked to be told of, now or in a summary,',
      "and the open comments people made on them and, for a caller who may access every playbook, on the organization's own things.",
      'Each new, comment and goal row says whether the caller has seen it, and the answer counts what waits on the caller and where they marked everything seen.',
    ].join(' '),
    route: { method: 'GET', path: '/activity' },
    permittedBy: ['org:read', 'playbook:read'],
    body: { kind: 'none' },
    inputSchema: ListActivityWithGoalsInputSchema,
    outputSchema: ListActivityWithGoalsOutputSchema,
    reasons: ['invalid_input', 'not_found'],
    handle: listedBy({
      kinds: kindsWithGoals,
      playbooks,
      rowsServed: rowsServedWithGoals(goals),
      countsOf: countsWithGoalsFor,
    }),
  });
  const markActivitySeen = defineHttpOperation('org', 'command', {
    name: 'mark_activity_seen',
    title: 'Mark activity seen',
    description: [
      'Records that the caller has seen new, comment and goal rows of the activity, by their address and at, everything through a cursor of a read, or both.',
      "It changes what the caller has seen alone, and answers the caller's counts and through after it.",
    ].join(' '),
    route: { method: 'POST', path: '/activity/seen' },
    permittedBy: ['org:read', 'playbook:read'],
    body: { kind: 'json' },
    inputSchema: MarkActivitySeenWithGoalsInputSchema,
    outputSchema: MarkActivitySeenWithGoalsOutputSchema,
    reasons: ['invalid_input', 'forbidden', 'conflict'],
    handle: markedBy({ itemOf: itemOfAnyAddress, countsOf: countsWithGoalsFor, playbooks }),
  });
  return { listActivity, markActivitySeen };
}

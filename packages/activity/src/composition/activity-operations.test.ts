import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { listActivity } from '../operations/list-activity.ts';
import { markActivitySeen } from '../operations/mark-activity-seen.ts';
import { activityOperationsOf } from './activity-composition.ts';

const goals = { read: () => Effect.succeed({ goals: { gaps: [] } }) };

describe('the operations of the activity', () => {
  it('are those of today where goals are not kept', () => {
    expect(activityOperationsOf()).toEqual([listActivity, markActivitySeen]);
  });

  it('are the same two by name and route where goals are kept, with schemas of their own', () => {
    const kept = activityOperationsOf(goals);

    expect(kept.map(({ registration: { name, route } }) => ({ name, route }))).toEqual([
      { name: 'list_activity', route: { method: 'GET', path: '/activity' } },
      { name: 'mark_activity_seen', route: { method: 'POST', path: '/activity/seen' } },
    ]);
    expect(kept[0]).not.toBe(listActivity);
    expect(kept[1]).not.toBe(markActivitySeen);
  });
});

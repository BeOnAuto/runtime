import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { activityEntityKinds } from '../entities/activity-kinds.ts';
import { summedCount } from '../operations/activity-counts.ts';
import { listActivity } from '../operations/list-activity.ts';
import { markActivitySeen } from '../operations/mark-activity-seen.ts';
import { activityOperationsOf } from './activity-composition.ts';
import { commentOperations, orgCommentOperations } from './comment-composition.ts';

describe('the operations of comments a catalog serves', () => {
  it('are making a comment, listing the comments, resolving one and reopening one, in a playbook and in the organization', () => {
    expect(
      [...commentOperations, ...orgCommentOperations].map(({ registration: { scope, name } }) => [scope, name]),
    ).toEqual([
      ['playbook', 'make_comment'],
      ['playbook', 'list_comments'],
      ['playbook', 'resolve_comment'],
      ['playbook', 'reopen_comment'],
      ['org', 'make_comment'],
      ['org', 'list_comments'],
      ['org', 'resolve_comment'],
      ['org', 'reopen_comment'],
    ]);
  });
});

const goals = { read: () => Effect.succeed({ goals: { gaps: [] } }), setAside: () => Effect.succeed(new Map()) };

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

describe('the kinds of entity the activity reads of its playbooks at once', () => {
  it('are its playbooks’ activity without goals and with them, each known by its name', () => {
    expect(activityEntityKinds(goals.setAside).map(({ name }) => name)).toEqual([
      'playbook_activity',
      'playbook_activity_with_goals',
    ]);
  });

  it('sum a count each playbook answers, and none for a playbook that answers no such count', () => {
    expect(summedCount([{ counts: { goals: 2 } }, { counts: {} }, { counts: { goals: 1 } }], 'goals')).toBe(3);
  });
});

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

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

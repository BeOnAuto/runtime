import type { CallerIdentity, Outcome } from '@on.auto/operations';
import { Schema } from 'effect';

import { listComments } from '../comments/list-comments.ts';
import { makeComment } from '../comments/make-comment.ts';
import { resolveComment } from '../comments/resolve-comment.ts';
import { activityHarness, ada, outputOf, priya } from './harness.ts';

export const run = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

export const otherRun = '019a4012-7c3e-7d10-9b2a-000000000002';

export const step = 'finance/definitions/workflow/close-the-week/4/steps/do/1/review';

export const reader: CallerIdentity = {
  ...ada,
  id: 'person:user_3pQr8',
  name: 'Tomás Ortega',
  permissions: ['playbook:read'],
  playbooks: ['finance'],
};

export const minute = (at: number) => `2026-11-02T10:${String(at).padStart(2, '0')}:00.000Z`;

const CommentSchema = Schema.Struct({
  id: Schema.String,
  address: Schema.String,
  open: Schema.Boolean,
  resolved_how: Schema.NullOr(Schema.String),
});

const ListedSchema = Schema.Struct({
  comments: Schema.Array(CommentSchema),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
});

export const commentOf = (outcome: Outcome) => Schema.decodeUnknownSync(CommentSchema)(outputOf(outcome));

export const listedOf = (outcome: Outcome) => Schema.decodeUnknownSync(ListedSchema)(outputOf(outcome));

export const addressesIn = (outcome: Outcome) => listedOf(outcome).comments.map(({ address }) => address);

export async function commenting() {
  const harness = activityHarness();
  await harness.created(priya, 'finance', '2026-11-01T10:00:00.000Z');
  await harness.created(ada, 'sales', '2026-11-01T10:00:00.000Z');
  return {
    ...harness,
    make: (caller: CallerIdentity, input: Schema.JsonObject, at = minute(0), playbook = 'finance') =>
      harness.inPlaybook(makeComment, { caller, playbook, input, at }),
    made: async (address: string, at: string, caller: CallerIdentity = priya) =>
      commentOf(
        await harness.inPlaybook(makeComment, {
          caller,
          playbook: 'finance',
          input: { address, text: `About ${address}` },
          at,
        }),
      ).id,
    comments: (input: Readonly<Record<string, string>> = {}, caller: CallerIdentity = reader, playbook = 'finance') =>
      harness.inPlaybook(listComments, { caller, playbook, input, encoding: 'strings' }),
    resolve: (id: string, how: string, caller: CallerIdentity = reader, at = minute(30)) =>
      harness.inPlaybook(resolveComment, { caller, playbook: 'finance', input: { id, how }, at }),
  };
}

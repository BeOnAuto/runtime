import { Caller, NotFound, PlaybookWriter, defineCommand } from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { commentDecider, commentStreamOf, type ResolvedHow } from '../facts/comment-facts.ts';
import { CommentIdField, HowInputField } from './comment-fields.ts';
import { CommentSchema, keptOfState, shownComment } from './comment-shown.ts';

interface Resolving {
  readonly id: string;
  readonly how: ResolvedHow;
}

const resolved = Effect.fnUntraced(function* ({ id, how }: Resolving) {
  const caller = yield* Caller;
  const { state } = yield* (yield* PlaybookWriter).execute(commentStreamOf(id), commentDecider, {
    kind: 'resolve',
    how,
    at: DateTime.formatIso(yield* DateTime.now),
    by: caller.id,
  });
  return yield* state === null
    ? new NotFound({ detail: 'There is no such comment in this playbook' })
    : shownComment(keptOfState(id, state));
});

export const resolveComment = defineCommand('playbook', {
  name: 'resolve_comment',
  title: 'Resolve a comment',
  description: [
    'Resolves a comment people made in Studio on the playbook, so it leaves the open comments and the activity.',
    'Use it once what the comment asked is done, with `how` acted, or with `how` dismissed when the person says to drop it.',
    '`id` is the id of the comment, as list_comments gives it.',
    'Resolving a comment resolved already records nothing and answers it as it stands.',
    'The person is told what was changed for each comment, and which were left open and why; make_comment is no tool, since a comment is what a person says and an agent reports its work to the person instead.',
  ].join(' '),
  route: { method: 'POST', path: '/comments/{id}/resolve' },
  permittedBy: ['playbook:read'],
  repeatable: true,
  inputSchema: Schema.Struct({ id: CommentIdField, how: HowInputField }),
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'not_found', 'conflict'],
  handle: resolved,
  plainLanguage: {
    task: 'resolve a comment',
    attempt: () => 'resolve the comment',
    explanations: {
      retired: {
        why: 'its playbook has been retired, so its comments can only be read',
        remedy: 'list_comments still reads them, open and resolved.',
      },
    },
    outcome: ({ resolved_how: how }) =>
      how === 'dismissed'
        ? 'The comment is dismissed: it leaves the open comments and the activity.'
        : 'The comment is resolved as acted on: it leaves the open comments and the activity.',
  },
});

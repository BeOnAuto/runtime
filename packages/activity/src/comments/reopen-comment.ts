import { OrgWriter, PlaybookWriter, defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { CommentIdField } from './comment-fields.ts';
import { CommentSchema } from './comment-shown.ts';
import { actedOnComment, notFoundInOrg, notFoundInPlaybook } from './resolve-comment.ts';

interface Reopening {
  readonly id: string;
}

const reopened = Effect.fnUntraced(function* ({ id }: Reopening) {
  return yield* actedOnComment(yield* PlaybookWriter, id, { kind: 'reopen' }, notFoundInPlaybook);
});

const reopenedInOrg = Effect.fnUntraced(function* ({ id }: Reopening) {
  return yield* actedOnComment(yield* OrgWriter, id, { kind: 'reopen' }, notFoundInOrg);
});

const ReopenCommentInputSchema = Schema.Struct({ id: CommentIdField });

const reopensResolved = [
  'It opens again a resolved comment, so it is among the open comments and in the activity again, new to everyone but the caller.',
  'Reopening an open comment records nothing and answers it as it stands.',
  'It answers the comment, with when and by whom it was reopened.',
];

export const reopenComment = defineHttpOperation('playbook', 'command', {
  name: 'reopen_comment',
  title: 'Reopen a comment',
  description: ['Reopens a comment people made on something of the playbook.', ...reopensResolved].join(' '),
  route: { method: 'POST', path: '/comments/{id}/reopen' },
  body: { kind: 'none' },
  repeatable: true,
  permittedBy: ['playbook:read'],
  inputSchema: ReopenCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'not_found', 'conflict'],
  handle: reopened,
});

export const reopenCommentInOrg = defineHttpOperation('org', 'command', {
  name: 'reopen_comment',
  title: 'Reopen a comment',
  description: ["Reopens a comment people made on one of the organization's own things.", ...reopensResolved].join(' '),
  route: { method: 'POST', path: '/comments/{id}/reopen' },
  body: { kind: 'none' },
  repeatable: true,
  permittedBy: ['org:read', 'playbook:read'],
  inputSchema: ReopenCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'not_found', 'conflict'],
  handle: reopenedInOrg,
});

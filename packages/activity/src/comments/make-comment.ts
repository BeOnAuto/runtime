import {
  Caller,
  PlaybookContext,
  type InvalidInput,
  PlaybookWriter,
  defineHttpOperation,
  randomUUIDv7,
  recordedCallerOf,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { commentDecider, commentStreamOf } from '../facts/comment-facts.ts';
import { commentTargetOf } from '../positions/comment-addresses.ts';
import { AddressInputField, TextInputField, refusedAt } from './comment-fields.ts';
import { CommentSchema, keptOfState, shownComment } from './comment-shown.ts';

const MakeCommentInputSchema = Schema.Struct({ address: AddressInputField, text: TextInputField });

type MakeCommentInput = typeof MakeCommentInputSchema.Type;

function addressIn(playbook: string, address: string): Effect.Effect<string, InvalidInput> {
  return commentTargetOf(address)?.playbook === playbook
    ? Effect.succeed(address)
    : Effect.fail(
        refusedAt('/address', `Expected the address of something of the playbook ${playbook} a comment takes`),
      );
}

const made = Effect.fnUntraced(function* (input: MakeCommentInput) {
  const caller = yield* Caller;
  const { playbook } = yield* PlaybookContext;
  const address = yield* addressIn(playbook, input.address);
  const id = randomUUIDv7();
  const comment = {
    address,
    text: input.text.trim(),
    madeBy: recordedCallerOf(caller),
    at: DateTime.formatIso(yield* DateTime.now),
  };
  yield* (yield* PlaybookWriter).execute(commentStreamOf(id), commentDecider, {
    kind: 'make',
    ...comment,
    by: caller.id,
  });
  return yield* shownComment(keptOfState(id, { ...comment, resolution: null }));
});

export const makeComment = defineHttpOperation('playbook', 'command', {
  name: 'make_comment',
  title: 'Make a comment',
  description: [
    'Records what a person says about something of the playbook, at its address: a definition at a version, a step, a run, an event, a block of a result, a request or the playbook.',
    'It answers the comment, open, with its place in Studio.',
  ].join(' '),
  route: { method: 'POST', path: '/comments' },
  successStatus: 201,
  permittedBy: ['playbook:read'],
  body: { kind: 'json' },
  inputSchema: MakeCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'conflict'],
  handle: made,
});

import {
  Caller,
  OrgWriter,
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  defineHttpOperation,
  randomUUIDv7,
  recordedCallerOf,
  type InvalidInput,
  type StreamWriter,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { commentDecider, commentStreamOf, type CommentState } from '../facts/comment-facts.ts';
import { commentTargetOf, playbookOfTarget, type CommentTarget } from '../positions/comment-addresses.ts';
import { definitionHeldFor, isOnADefinition } from '../positions/definition-addresses.ts';
import { AddressInputField, AnchorInputField, TextInputField, refusedAt } from './comment-fields.ts';
import { CommentSchema, keptOfState, shownComment } from './comment-shown.ts';

const MakeCommentInputSchema = Schema.Struct({
  address: AddressInputField,
  text: TextInputField,
  anchor: Schema.optionalKey(Schema.NullOr(AnchorInputField)),
});

type MakeCommentInput = typeof MakeCommentInputSchema.Type;

function targetOf(
  owner: string | undefined,
  address: string,
  refusal: string,
): Effect.Effect<CommentTarget, InvalidInput> {
  const target = commentTargetOf(address);
  return target !== undefined && playbookOfTarget(target) === owner
    ? Effect.succeed(target)
    : Effect.fail(refusedAt('/address', refusal));
}

function madeWith(input: MakeCommentInput, definition: string | null, writer: StreamWriter) {
  return Effect.gen(function* () {
    const caller = yield* Caller;
    const id = randomUUIDv7();
    const comment: Omit<CommentState, 'resolution' | 'reopening'> = {
      address: input.address,
      definition,
      text: input.text.trim(),
      anchor: input.anchor ?? null,
      madeBy: recordedCallerOf(caller),
      at: DateTime.formatIso(yield* DateTime.now),
    };
    yield* writer.execute(commentStreamOf(id), commentDecider, { kind: 'make', ...comment, by: caller.id });
    return yield* shownComment(keptOfState(id, { ...comment, resolution: null, reopening: null }));
  });
}

const made = Effect.fnUntraced(function* (input: MakeCommentInput) {
  const { playbook } = yield* PlaybookContext;
  const writer = yield* PlaybookWriter;
  const target = yield* targetOf(
    playbook,
    input.address,
    `Expected the address of something of the playbook ${playbook} a comment takes`,
  );
  if (!isOnADefinition(target)) {
    return yield* madeWith(input, null, writer);
  }
  const definition = yield* definitionHeldFor(yield* PlaybookReader, target);
  return yield* madeWith(input, definition, writer.ofDefinition(definition));
});

const madeInOrg = Effect.fnUntraced(function* (input: MakeCommentInput) {
  const writer = yield* OrgWriter;
  yield* targetOf(undefined, input.address, "Expected the address of one of the organization's things a comment takes");
  return yield* madeWith(input, null, writer);
});

const answered = 'It answers the comment, open, with its place in Studio.';

export const makeComment = defineHttpOperation('playbook', 'command', {
  name: 'make_comment',
  title: 'Make a comment',
  description: [
    'Records what a person says about something of the playbook, at its address: a definition at a version, a step, a run, an event, a block of a result, a request, the playbook, or a part of one.',
    'With anchor, it keeps where on the thing the person dropped it.',
    answered,
  ].join(' '),
  route: { method: 'POST', path: '/comments' },
  successStatus: 201,
  permittedBy: ['playbook:read'],
  body: { kind: 'json' },
  inputSchema: MakeCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'not_found', 'conflict'],
  handle: made,
});

export const makeCommentInOrg = defineHttpOperation('org', 'command', {
  name: 'make_comment',
  title: 'Make a comment',
  description: [
    "Records what a person says about one of the organization's things, at its address: the organization, a connection, a member, a page of Settings, or a part of one.",
    'With anchor, it keeps where on the thing the person dropped it.',
    answered,
  ].join(' '),
  route: { method: 'POST', path: '/comments' },
  successStatus: 201,
  permittedBy: ['org:read', 'playbook:read'],
  body: { kind: 'json' },
  inputSchema: MakeCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'conflict'],
  handle: madeInOrg,
});

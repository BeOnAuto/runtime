import {
  Caller,
  NotFound,
  OrgWriter,
  PlaybookReader,
  PlaybookWriter,
  defineCommand,
  type PlainLanguage,
  type StreamWriter,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { commentDecider, commentStreamOf, type ResolvedHow } from '../facts/comment-facts.ts';
import { noPagesOfTheirOwn, pagesOfTheirOwn, type PagesOfTheirOwn } from '../positions/current-addresses.ts';
import { addressedAsHeld } from '../positions/definition-addresses.ts';
import { CommentIdField, HowInputField } from './comment-fields.ts';
import { CommentSchema, keptOfState, shownComment, type KeptComment } from './comment-shown.ts';

interface Resolving {
  readonly id: string;
  readonly how: ResolvedHow;
}

type CommentAct = { readonly kind: 'resolve'; readonly how: ResolvedHow } | { readonly kind: 'reopen' };

interface ActedOn {
  readonly notFound: string;
  readonly pages: PagesOfTheirOwn;
  readonly writerOf: (stream: string) => Effect.Effect<StreamWriter>;
  readonly namedNow: (kept: KeptComment, definition: string | null) => Effect.Effect<KeptComment>;
}

export const inThePlaybook: Effect.Effect<ActedOn, never, PlaybookReader | PlaybookWriter> = Effect.gen(function* () {
  const reader = yield* PlaybookReader;
  const writer = yield* PlaybookWriter;
  return {
    notFound: 'There is no such comment in this playbook',
    pages: yield* pagesOfTheirOwn,
    writerOf: (stream) =>
      Effect.map(reader.definitionHolding(stream), (definition) =>
        definition === undefined ? writer : writer.ofDefinition(definition),
      ),
    namedNow: (kept, definition) =>
      definition === null
        ? Effect.succeed(kept)
        : Effect.map(reader.nameHeldBy(definition), (held) => addressedAsHeld(kept, held)),
  };
});

export const inTheOrg: Effect.Effect<ActedOn, never, OrgWriter> = Effect.gen(function* () {
  const writer = yield* OrgWriter;
  return {
    notFound: 'There is no such comment of the organization',
    pages: noPagesOfTheirOwn,
    writerOf: () => Effect.succeed(writer),
    namedNow: (kept) => Effect.succeed(kept),
  };
});

export function actedOnComment(id: string, act: CommentAct, { notFound, pages, writerOf, namedNow }: ActedOn) {
  return Effect.gen(function* () {
    const caller = yield* Caller;
    const stream = commentStreamOf(id);
    const writer = yield* writerOf(stream);
    const { state } = yield* writer.execute(stream, commentDecider, {
      ...act,
      at: DateTime.formatIso(yield* DateTime.now),
      by: caller.id,
    });
    if (state === null) {
      return yield* new NotFound({ detail: notFound });
    }
    return yield* shownComment(yield* namedNow(keptOfState(id, state), state.definition), pages);
  });
}

const resolved = Effect.fnUntraced(function* ({ id, how }: Resolving) {
  return yield* actedOnComment(id, { kind: 'resolve', how }, yield* inThePlaybook);
});

const resolvedInOrg = Effect.fnUntraced(function* ({ id, how }: Resolving) {
  return yield* actedOnComment(id, { kind: 'resolve', how }, yield* inTheOrg);
});

const ResolveCommentInputSchema = Schema.Struct({ id: CommentIdField, how: HowInputField });

const usedOnceDone = [
  'Use it once what the comment asked is done, with `how` acted, or with `how` dismissed when the person says to drop it.',
];

const toldAfter = ['Resolving a comment resolved already records nothing and answers it as it stands.'];

const resolvedInWords: PlainLanguage<Resolving, typeof CommentSchema.Type> = {
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
};

export const resolveComment = defineCommand('playbook', {
  name: 'resolve_comment',
  title: 'Resolve a comment',
  description: [
    'Resolves a comment people made in Studio on the playbook, so it leaves the open comments and the activity.',
    ...usedOnceDone,
    '`id` is the id of the comment, as list_comments gives it.',
    ...toldAfter,
  ].join(' '),
  route: { method: 'POST', path: '/comments/{id}/resolve' },
  permittedBy: ['playbook:read'],
  repeatable: true,
  inputSchema: ResolveCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'not_found', 'conflict'],
  handle: resolved,
  plainLanguage: resolvedInWords,
});

export const resolveCommentInOrg = defineCommand('org', {
  name: 'resolve_comment',
  title: 'Resolve a comment',
  description: [
    "Resolves a comment people made in Studio, so it leaves the open comments and the activity: with `playbook`, one of that playbook's, and without it, one of the organization's own.",
    ...usedOnceDone,
    '`id` is the id of the comment, as list_comments gives it, with the `playbook` it was listed with, or none.',
    ...toldAfter,
  ].join(' '),
  route: { method: 'POST', path: '/comments/{id}/resolve' },
  permittedBy: ['org:read', 'playbook:read'],
  repeatable: true,
  inputSchema: ResolveCommentInputSchema,
  outputSchema: CommentSchema,
  reasons: ['invalid_input', 'not_found', 'conflict'],
  handle: resolvedInOrg,
  plainLanguage: resolvedInWords,
});

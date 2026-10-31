import {
  PlaybookReader,
  InvalidInput,
  PagingInputFields,
  PagingOutputFields,
  counted,
  cursorOfParts,
  defaultPageLimit,
  defineQuery,
  partsOfCursor,
  plainNumber,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedValue,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { readingKeyOf } from '../conversations/conversation-keys.ts';
import { openRequestsName } from './open-requests.ts';
import { StandingSchema, requestRowFrom, routeOfRow, type OpenRequestRow } from './request-rows.ts';

const InteractionSchema = Schema.Struct({
  run_id: Schema.String.annotate({ description: 'The run of the request, to answer with answer_interaction' }),
  type: Schema.String.annotate({ description: 'The type of the function that asked' }),
  function: Schema.String.annotate({ description: 'The function that asked' }),
  version: Schema.Int.annotate({ description: 'The version of the function that asked' }),
  to: Schema.String.annotate({ description: 'The party the request goes to' }),
  delivery: Schema.NullOr(Schema.Struct({ server: Schema.String, tool: Schema.String })).annotate({
    description:
      'The tool the function delivers the request through, as its deliver names it, or null for a request held for an agent',
  }),
  message: Schema.String.annotate({ description: 'The message of the request' }),
  takes_answer: Schema.Boolean.annotate({ description: 'true for a question, false for a notification' }),
  answer_schema: Schema.NullOr(Schema.JsonObject).annotate({
    description:
      'The JSON Schema an answer must match, as the request recorded it when asked: the one answer_interaction checks, even once its function has changed; null for a notification',
  }),
  requested_at: Schema.String.annotate({ description: 'When the request was made, in ISO 8601 UTC' }),
  expires_at: Schema.String.annotate({ description: 'When the request expires unanswered, in ISO 8601 UTC' }),
  attempts: Schema.Int.annotate({ description: 'The delivery attempts made so far' }),
  conversation: Schema.NullOr(Schema.String).annotate({
    description:
      'The conversation the playbook reads replies in, as its delivery keys it, while the request takes an answer and its delivery reads replies; null for a request answered through answer_interaction alone.',
  }),
  answerer: Schema.NullOr(Schema.String).annotate({
    description:
      "The party whose reply the playbook takes as the answer, the function's from, or its to when it gives no from; null for a request that takes no reply.",
  }),
  reply_refusals: Schema.Int.annotate({
    description:
      'How many replies from the answerer the playbook refused because they were not an answer the function takes, each told how to answer where its reading tells.',
  }),
  standing: StandingSchema.annotate({
    description:
      'How its delivery stands: held_for_an_agent, to_deliver, delivering, delivered, retrying, undelivered once every attempt failed, or cancelling once a cancel was asked; an answered request leaves the list',
  }),
}).annotate({ identifier: 'Interaction', description: 'An open request of a function' });

const requestNoun = { one: 'request', other: 'requests' };

function refusedInWords(interactions: readonly { readonly reply_refusals: number }[]): string {
  const refused = interactions.filter(({ reply_refusals: refusals }) => refusals > 0).length;
  if (refused === 0) {
    return '';
  }
  return refused === 1
    ? ' One of them has had a reply refused.'
    : ` ${plainNumber(refused)} of them have had a reply refused.`;
}

const FilterText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

const description = [
  'Lists the open requests of the playbook, newest first: what each function asked, of whom, through which tool or held for an agent,',
  'until when and how its delivery stands, with the `run_id` that answer_interaction takes.',
  'Each carries its `answer_schema`, the shape answer_interaction checks an answer against, as recorded when asked,',
  'which get_definition may no longer show; null for a notification.',
  'Use it when the person asks what the playbook is waiting on, or to find the request they answer.',
  '`to` keeps the requests to one party, `type` to one type of function and `function` to one name, which with `type` names one function; `cursor` is the next_cursor of the page before, to read on only as the person needs.',
  'Every reader of the playbook sees each party and message, as a run’s input is seen.',
].join(' ');

const CursorSchema = Schema.Tuple([Schema.Int, Schema.String]);

const isCursor = Schema.is(CursorSchema);

const badCursor = new InvalidInput({
  detail: 'The cursor is not one list_interactions gave',
  issues: [{ pointer: '/cursor', detail: 'Expected the next_cursor of a page of list_interactions' }],
});

function afterOf(cursor: string | undefined): Effect.Effect<readonly ProjectedValue[] | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts) ? Effect.succeed(parts) : Effect.fail(badCursor);
}

const answerSchemaFrom = Schema.decodeUnknownSync(Schema.NullOr(Schema.fromJsonString(Schema.JsonObject)));

function deliveryShown(kept: OpenRequestRow) {
  const route = routeOfRow(kept);
  return route.kind === 'agent' ? null : route.delivery;
}

function shownOf({ key, row }: ProjectedKeyedRow) {
  const kept = requestRowFrom(row);
  return [
    {
      run_id: key,
      type: kept.type,
      function: kept.function,
      version: kept.version,
      to: kept.party,
      delivery: deliveryShown(kept),
      message: kept.message,
      takes_answer: kept.answers,
      answer_schema: answerSchemaFrom(kept.answer_schema),
      requested_at: new Date(kept.requested_at).toISOString(),
      expires_at: new Date(kept.expires_at).toISOString(),
      attempts: kept.attempts,
      conversation: kept.conversation === null ? null : readingKeyOf(kept.conversation),
      answerer: kept.conversation === null ? null : kept.answerer,
      reply_refusals: kept.reply_refusals,
      standing: kept.standing,
    },
  ];
}

interface Listing {
  readonly to?: string | undefined;
  readonly type?: string | undefined;
  readonly function?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

function conditionsOf({ to, type, function: name }: Listing): readonly ProjectedCondition[] {
  const asked: readonly (readonly [string, string | undefined])[] = [
    ['party', to],
    ['type', type],
    ['function', name],
  ];
  return [
    { column: 'open', equals: true },
    ...asked.flatMap(([column, equals]) => (equals === undefined ? [] : [{ column, equals }])),
  ];
}

const listed = Effect.fnUntraced(function* (listing: Listing) {
  const { limit = defaultPageLimit, cursor } = listing;
  const after = yield* afterOf(cursor);
  const where = conditionsOf(listing);
  const rows = yield* (yield* PlaybookReader).readProjectedRows(openRequestsName, {
    where,
    orderBy: ['requested_at'],
    order: 'desc',
    ...(after === undefined ? {} : { after }),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    interactions: page.flatMap((kept) => shownOf(kept)),
    has_more: hasMore,
    next_cursor: hasMore ? cursorOfParts([Number(last.row['requested_at']), last.key]) : null,
  };
});

export const listInteractions = defineQuery('playbook', {
  name: 'list_interactions',
  title: 'List open requests',
  description,
  route: { method: 'GET', path: '/interactions' },
  inputSchema: Schema.Struct({
    to: Schema.optionalKey(FilterText.annotate({ description: 'Only the requests to this party' })),
    type: Schema.optionalKey(FilterText.annotate({ description: 'Only the requests of functions of this type' })),
    function: Schema.optionalKey(
      FilterText.annotate({ description: 'Only the requests of functions of this name, of the type given if any' }),
    ),
    limit: PagingInputFields.limit,
    cursor: PagingInputFields.cursor,
  }),
  outputSchema: Schema.Struct({ interactions: Schema.Array(InteractionSchema), ...PagingOutputFields }),
  reasons: ['invalid_input'],
  handle: listed,
  plainLanguage: {
    task: 'list the open requests',
    attempt: () => 'list the open requests',
    outcome: ({ interactions }) =>
      interactions.length === 0
        ? 'No request is waiting.'
        : `Found ${counted(interactions.length, requestNoun)} waiting on this page.${refusedInWords(interactions)}`,
  },
});

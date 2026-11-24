import {
  PlaybookContext,
  PlaybookReader,
  EventPagingInputFields,
  EventPagingOutputFields,
  PublicEventSchema,
  defaultPageLimit,
  defineQuery,
  eventsPageOf,
  keptContentOf,
  mostPublicEventDataBytes,
  presentationOf,
  streamPrefixOfPlaybook,
  type ContentHolders,
  type Presentation,
  type KeptContent,
  type Presenter,
  type RecordedFact,
  type RecordedSelection,
} from '@on.auto/operations';
import { Effect, Schema, SchemaTransformation } from 'effect';

import { eventsFound } from '../plain-language/feed-words.ts';

const alwaysListed = [
  'definitions saved and retired',
  'runs started and how they ended',
  'the steps of workflow runs',
  'tool calls',
  'the events published to it',
];

function listedIn(presenters: readonly Presenter[]): string {
  const listed = [...alwaysListed, ...presenters.flatMap(({ listedAs }) => (listedAs === undefined ? [] : [listedAs]))];
  return listed.map((what, index) => (index === listed.length - 1 ? `and ${what}` : what)).join(', ');
}

function descriptionOf(presenters: readonly Presenter[]): string {
  return [
    `Lists what happened in the playbook a page at a time, newest first: ${listedIn(presenters)},`,
    'each with a summary in plain words, its fact as data with a large field as its size, and its metadata;',
    'get_event reads one event whole.',
    "Use it to follow the playbook's activity, to see what one run did, or to find the events a page or a workflow's schedule can take.",
    '`type` keeps one type of event, `run_id` one run and every run it started, `since` what was recorded from that time on,',
    'and `cursor` is the next_cursor of the page before.',
    "The playbook's own creation, update and retirement are not among the events; list_playbooks shows them.",
  ].join(' ');
}

const RunIdField = Schema.String.annotate({
  description: 'The id of a run that no other run started: only what it and the runs it started recorded',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

export function feedInput(publicTypes: readonly string[]) {
  return Schema.Struct({
    cursor: EventPagingInputFields.cursor,
    since: EventPagingInputFields.since,
    type: Schema.optionalKey(
      Schema.Literals(publicTypes).annotate({ description: 'Only the events of this type, by its public name' }),
    ),
    run_id: Schema.optionalKey(RunIdField),
    order: EventPagingInputFields.order,
    limit: EventPagingInputFields.limit,
  });
}

type FeedInput = ReturnType<typeof feedInput>['Type'];

export const EventsPage = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...EventPagingOutputFields });

export function requireSomePublicType(publicTypes: readonly string[]): void {
  if (publicTypes.length === 0) {
    throw new Error('The events of a playbook need a presenter that shows at least one type of event');
  }
}

function selectionOf(run: string | undefined): RecordedSelection {
  return run === undefined ? { kind: 'everything' } : { kind: 'correlated', correlation: run };
}

export type ContentReading = (records: readonly RecordedFact[]) => Effect.Effect<KeptContent, never, PlaybookReader>;

function everyContentRead(holders: ContentHolders): ContentReading {
  return (records) => keptContentOf(records, mostPublicEventDataBytes, holders);
}

export function feedReader(presentation: Presentation, readingContent: ContentReading) {
  return Effect.fnUntraced(function* (input: FeedInput) {
    const { cursor, since, type, run_id: run, order = 'desc', limit = defaultPageLimit } = input;
    const paging = { order, limit, ...(cursor === undefined ? {} : { cursor }) };
    const page = yield* (yield* PlaybookReader).readRecorded(selectionOf(run), {
      ...paging,
      ...(since === undefined ? {} : { since }),
      ...(type === undefined ? {} : { types: presentation.storedTypesOf(type) }),
    });
    const content = yield* readingContent(page.records);
    const showing = { streamPrefix: streamPrefixOfPlaybook(yield* PlaybookContext), content, view: 'page' } as const;
    const { events, hasMore, nextCursor } = eventsPageOf(presentation, page, {
      ...paging,
      showing,
      ...(type === undefined ? {} : { keeps: (event) => event.type === type }),
    });
    return { events, has_more: hasMore, next_cursor: nextCursor };
  });
}

export function defineListPlaybookEvents(presenters: readonly Presenter[], holders: ContentHolders) {
  const presentation = presentationOf(presenters);
  requireSomePublicType(presentation.publicTypes);
  return defineQuery('playbook', {
    name: 'list_playbook_events',
    staleOn: [{ kind: 'event' }],
    title: 'List playbook events',
    description: descriptionOf(presenters),
    route: { method: 'GET', path: '/events' },
    inputSchema: feedInput(presentation.publicTypes),
    outputSchema: EventsPage,
    reasons: ['invalid_input'],
    handle: feedReader(presentation, everyContentRead(holders)),
    plainLanguage: {
      task: 'read what happened in the playbook',
      attempt: () => 'read what happened in the playbook',
      outcome: eventsFound,
    },
  });
}

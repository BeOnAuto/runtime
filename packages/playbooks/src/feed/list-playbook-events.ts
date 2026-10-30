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
  type Presentation,
  type Presenter,
  type RecordedSelection,
} from '@on.auto/operations';
import { Effect, Schema, SchemaTransformation } from 'effect';

import { eventsFound } from '../plain-language/feed-words.ts';

const description = [
  'Lists what happened in the playbook a page at a time, newest first: definitions saved and retired, runs started and how they ended,',
  'the steps of workflow runs, tool calls, and the events published to it, each with a summary in plain words,',
  'its fact as data with a large field as its size, and its metadata; get_event reads one event whole.',
  "Use it to follow the playbook's activity, to see what one run did, or to find the events a recall function or a workflow's schedule can take.",
  '`type` keeps one type of event, `run_id` one run and every run it started, `since` what was recorded from that time on,',
  'and `cursor` is the next_cursor of the page before, to read on only as the person needs.',
  "The playbook's own creation, update and retirement are not among the events; list_playbooks shows them.",
].join(' ');

const RunIdField = Schema.String.annotate({
  description: 'The id of a run that no other run started: only what it and the runs it started recorded',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function feedInput(publicTypes: readonly string[]) {
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

const EventsPage = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...EventPagingOutputFields });

function requireSomePublicType(publicTypes: readonly string[]): void {
  if (publicTypes.length === 0) {
    throw new Error('The events of a playbook need a presenter that shows at least one type of event');
  }
}

function selectionOf(run: string | undefined): RecordedSelection {
  return run === undefined ? { kind: 'everything' } : { kind: 'correlated', correlation: run };
}

function feedReader(presentation: Presentation) {
  return Effect.fnUntraced(function* (input: FeedInput) {
    const { cursor, since, type, run_id: run, order = 'desc', limit = defaultPageLimit } = input;
    const paging = { order, limit, ...(cursor === undefined ? {} : { cursor }) };
    const page = yield* (yield* PlaybookReader).readRecorded(selectionOf(run), {
      ...paging,
      ...(since === undefined ? {} : { since }),
      ...(type === undefined ? {} : { types: presentation.storedTypesOf(type) }),
    });
    const content = yield* keptContentOf(page.records, mostPublicEventDataBytes);
    const showing = { streamPrefix: streamPrefixOfPlaybook(yield* PlaybookContext), content, view: 'page' } as const;
    const { events, hasMore, nextCursor } = eventsPageOf(presentation, page, {
      ...paging,
      showing,
      ...(type === undefined ? {} : { keeps: (event) => event.type === type }),
    });
    return { events, has_more: hasMore, next_cursor: nextCursor };
  });
}

export function defineListPlaybookEvents(presenters: readonly Presenter[]) {
  const presentation = presentationOf(presenters);
  requireSomePublicType(presentation.publicTypes);
  return defineQuery('playbook', {
    name: 'list_playbook_events',
    title: 'List playbook events',
    description,
    route: { method: 'GET', path: '/events' },
    inputSchema: feedInput(presentation.publicTypes),
    outputSchema: EventsPage,
    reasons: ['invalid_input'],
    handle: feedReader(presentation),
    plainLanguage: {
      task: 'read what happened in the playbook',
      attempt: () => 'read what happened in the playbook',
      outcome: eventsFound,
    },
  });
}

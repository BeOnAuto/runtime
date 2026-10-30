import {
  PlaybookContext,
  PlaybookReader,
  EventPagingInputFields,
  EventPagingOutputFields,
  PublicEventSchema,
  defaultPageLimit,
  defineHttpOperation,
  eventsPageOf,
  keptContentOf,
  mostPublicEventDataBytes,
  presentationOf,
  streamPrefixOfPlaybook,
  type Presentation,
  type Presenter,
  type RecordedEvent,
  type RecordedPageRequest,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { RunIdInputField } from '../operations/definition-fields.ts';
import { noRunCalled } from '../runs/run-lookup.ts';

const description = [
  'Reads what happened in one run, a page at a time, oldest first: when it started and ended,',
  'each tool call a function made and what the tool answered, and each step of a workflow with what it waited for and the runs it started.',
  "Each event holds its fact as data, a field such as an input, an output, a tool's arguments or its answer whole within 2 KiB and as its size beyond,",
  'and its metadata: where it is recorded, when, who acted, the definition, the run and the chain; get_event reads one event whole.',
  'Use it to see what a run did, such as which tools it called before it did not succeed.',
  "`run_id` is the run's id, `order` reads newest first when desc, and `cursor` is the next_cursor of the page before.",
].join(' ');

const RunHistoryInput = Schema.Struct({
  run_id: RunIdInputField,
  order: EventPagingInputFields.order,
  limit: EventPagingInputFields.limit,
  cursor: EventPagingInputFields.cursor,
});

const EventsPage = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...EventPagingOutputFields });

const cancelRequested = 'run_cancel_requested';

const newestHeadAlone: RecordedPageRequest = { order: 'desc', limit: 1, dataOf: [] };

function isACancel({ type }: RecordedEvent): boolean {
  return type === cancelRequested;
}

function isACancelAlone({ type, version }: RecordedEvent): boolean {
  return type === cancelRequested && version === 1;
}

function holdsNoRun(heads: readonly RecordedEvent[]): boolean {
  const [newest] = heads;
  return newest === undefined || isACancelAlone(newest);
}

function newestHeadOf(id: string) {
  return Effect.gen(function* () {
    const { records } = yield* (yield* PlaybookReader).readRecorded({ kind: 'run', run: id }, newestHeadAlone);
    return records;
  });
}

function historyReader(presentation: Presentation) {
  return Effect.fnUntraced(function* ({
    run_id: id,
    order = 'asc',
    limit = defaultPageLimit,
    cursor,
  }: typeof RunHistoryInput.Type) {
    const paging = { order, limit, ...(cursor === undefined ? {} : { cursor }) };
    const page = yield* (yield* PlaybookReader).readRecorded({ kind: 'run', run: id }, paging);
    if (page.records.every((record) => isACancel(record)) && holdsNoRun(yield* newestHeadOf(id))) {
      return yield* Effect.fail(noRunCalled(id));
    }
    const content = yield* keptContentOf(page.records, mostPublicEventDataBytes);
    const showing = { streamPrefix: streamPrefixOfPlaybook(yield* PlaybookContext), content, view: 'page' } as const;
    const { events, hasMore, nextCursor } = eventsPageOf(presentation, page, { ...paging, showing });
    return { events, has_more: hasMore, next_cursor: nextCursor };
  });
}

export function defineGetRunHistory(presenters: readonly Presenter[]) {
  return defineHttpOperation('playbook', 'query', {
    name: 'get_run_history',
    title: 'Get run history',
    description,
    route: { method: 'GET', path: '/runs/{run_id}/history' },
    body: { kind: 'none' },
    inputSchema: RunHistoryInput,
    answer: { kind: 'json', outputSchema: EventsPage },
    reasons: ['not_found', 'invalid_input'],
    handle: historyReader(presentationOf(presenters)),
  });
}

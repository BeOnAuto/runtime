import {
  EventPagingInputFields,
  EventPagingOutputFields,
  PlaybookContext,
  PlaybookReader,
  PublicEventSchema,
  defineHttpOperation,
  eventsPageOf,
  mostRecordsInAPage,
  nothingKept,
  presentationOf,
  streamPrefixOfPlaybook,
  type Presentation,
  type Presenter,
} from '@on.auto/operations';
import { Effect, Schema, SchemaTransformation } from 'effect';

export interface RunTreeBounds {
  readonly eventsInAPage: number;
  readonly pagesAtMost: number;
}

export const runTreeBounds: RunTreeBounds = { eventsInAPage: mostRecordsInAPage, pagesAtMost: 10 };

const description = [
  'Reads the events of one run and every run it started, oldest first, as list_playbook_events lists them by its run_id,',
  'in one answer of up to ten pages: each content an event holds is given by its digest and size alone, unread, so a long run reads quickly.',
  "`run_id` is the run's id, and `cursor` is the next_cursor of the answer before.",
].join(' ');

const RunTreeInput = Schema.Struct({
  run_id: Schema.String.annotate({ description: 'The id of a run that no other run started' })
    .check(Schema.isUUID())
    .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase())),
  cursor: EventPagingInputFields.cursor,
});

const RunTree = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...EventPagingOutputFields });

interface Read {
  readonly events: readonly (typeof PublicEventSchema.Type)[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

function treeReader(presentation: Presentation, { eventsInAPage, pagesAtMost }: RunTreeBounds) {
  return Effect.fnUntraced(function* ({ run_id: run, cursor }: typeof RunTreeInput.Type) {
    const reader = yield* PlaybookReader;
    const showing = {
      streamPrefix: streamPrefixOfPlaybook(yield* PlaybookContext),
      content: nothingKept,
      view: 'page',
    } as const;
    const pageFrom = (from: string | undefined) =>
      Effect.gen(function* () {
        const paging = { order: 'asc', limit: eventsInAPage, ...(from === undefined ? {} : { cursor: from }) } as const;
        const page = yield* reader.readRecorded({ kind: 'correlated', correlation: run }, paging);
        return eventsPageOf(presentation, page, { ...paging, showing });
      });
    const readOn = (before: Read, pagesLeft: number): Effect.Effect<Read, Effect.Error<ReturnType<typeof pageFrom>>> =>
      !before.hasMore || pagesLeft === 0
        ? Effect.succeed(before)
        : Effect.flatMap(pageFrom(before.nextCursor ?? undefined), (page) =>
            readOn({ ...page, events: [...before.events, ...page.events] }, pagesLeft - 1),
          );
    const { events, hasMore, nextCursor } = yield* readOn(
      { events: [], hasMore: true, nextCursor: cursor ?? null },
      pagesAtMost,
    );
    return { events, has_more: hasMore, next_cursor: hasMore ? nextCursor : null };
  });
}

export function defineGetRunTree(presenters: readonly Presenter[], bounds: RunTreeBounds = runTreeBounds) {
  return defineHttpOperation('playbook', 'query', {
    name: 'get_run_tree',
    staleOn: [{ kind: 'event' }],
    title: 'Get run tree',
    description,
    route: { method: 'GET', path: '/runs/{run_id}/tree' },
    body: { kind: 'none' },
    inputSchema: RunTreeInput,
    outputSchema: RunTree,
    reasons: ['invalid_input'],
    handle: treeReader(presentationOf(presenters), bounds),
  });
}

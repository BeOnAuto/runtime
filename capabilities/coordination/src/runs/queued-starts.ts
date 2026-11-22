import { ListedDefinitionSchema, definitionNamePattern } from '@on.auto/definitions';
import {
  EventPagingInputFields,
  InvalidInput,
  NotFound,
  PagingOutputFields,
  PlaybookReader,
  cursorOfParts,
  defaultPageLimit,
  defineQuery,
  definitionOfStreamPrefix,
  partsOfCursor,
} from '@on.auto/operations';
import { counted, quoted } from '@on.auto/phrasing';
import type { QueuedPlace, QueuedStart, QueuedStartReads } from '@on.auto/workflow-host';
import { Effect, Option, Schema } from 'effect';

const runNoun = { one: 'run', other: 'runs' };

const QueuedEventSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the event, unique among the events of its source' }),
  type: Schema.String.annotate({ description: 'What happened' }),
  source: Schema.String.annotate({ description: 'Where the event comes from, a URI reference' }),
  subject: Schema.optionalKey(Schema.String.annotate({ description: 'What the event is about, within its source' })),
  time: Schema.String.annotate({ description: 'When it happened, in RFC 3339' }),
}).annotate({ description: 'The event it starts for: its `id`, `type`, `source`, `subject` and `time`' });

const QueuedStartSchema = Schema.Struct({
  run_id: Schema.String.annotate({ description: 'The id the run has once it starts' }),
  event: QueuedEventSchema,
  due: Schema.String.annotate({ description: 'The earliest time it can start, in ISO 8601 UTC' }),
  attempts: Schema.Int.annotate({ description: 'How many times it tried to start and failed' }),
}).annotate({ identifier: 'QueuedStart', description: 'A run of the workflow that is queued to start' });

const WorkflowStatusSchema = ListedDefinitionSchema.fields.status;

const statusOf = Schema.decodeUnknownEffect(WorkflowStatusSchema);

const QueuedStartsPageSchema = Schema.Struct({
  status: WorkflowStatusSchema.annotate({
    description:
      "The workflow's status: active; paused, when it starts no runs until it is resumed; or retired, until it is restored",
  }),
  queued_starts: Schema.Array(QueuedStartSchema),
  ...PagingOutputFields,
});

type QueuedStartsPageAnswered = typeof QueuedStartsPageSchema.Type;

const description = [
  'Lists the runs of a workflow that are queued to start, in the order they come due.',
  'Use it to tell the person what is still queued and when the next one can start.',
  'A workflow starts only so many runs a minute for the events that match its trigger, and queues the rest for a later minute.',
  'Each queued run has the event it starts for, `due`, the earliest time it can start, and `attempts`, how many times it tried to start and failed.',
  'When many are queued, the later ones start a minute or more after their `due`.',
  'A queued run is refused and never starts if its workflow is paused when it comes due, so say so to the person when the workflow is paused.',
  '`get_definition` says how many are queued.',
  '`cursor` is the next_cursor of the page before.',
].join(' ');

const CursorSchema = Schema.Tuple([Schema.Int, Schema.String]);

const isCursor = Schema.is(CursorSchema);

const badCursor = new InvalidInput({
  detail: 'The cursor is not one list_queued_starts gave',
  issues: [{ pointer: '/cursor', detail: 'Expected the next_cursor of a page of list_queued_starts' }],
});

function afterOf(cursor: string | undefined): Effect.Effect<QueuedPlace | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts) ? Effect.succeed({ dueAt: parts[0], runId: parts[1] }) : Effect.fail(badCursor);
}

interface FoundWorkflow {
  readonly filed: Parameters<QueuedStartReads['queuedStartsPage']>[0];
  readonly status: string;
}

function workflowNamed(name: string) {
  return Effect.flatMap(
    PlaybookReader.use((reader) => reader.holderOfName('workflow', name)),
    (held) => {
      const found: Option.Option<FoundWorkflow> =
        held === undefined
          ? Option.none()
          : Option.map(definitionOfStreamPrefix(held.definitionKey), (filed) => ({ filed, status: held.status }));
      return Option.match(found, {
        onNone: () => Effect.fail(new NotFound({ detail: `There is no workflow ${name} in this playbook` })),
        onSome: ({ filed, status }: FoundWorkflow) =>
          Effect.map(Effect.orDie(statusOf(status)), (known) => ({ filed, status: known })),
      });
    },
  );
}

function shownOf({ runId, event, dueAt, attempts }: QueuedStart) {
  return { run_id: runId, event, due: new Date(dueAt).toISOString(), attempts };
}

function cursorAfter(starts: readonly QueuedStart[], more: boolean): string | null {
  const last = more ? starts.at(-1) : undefined;
  return last === undefined ? null : cursorOfParts([last.dueAt, last.runId]);
}

interface Asked {
  readonly workflow: string;
  readonly cursor?: string | undefined;
}

function ofTheWorkflow(workflow: string): string {
  return `of the workflow ${quoted(workflow)}`;
}

const moreRemain = ' More remain after these.';

function refusedWhilePaused(onlyOneRun: boolean): string {
  return ` The workflow is paused, so ${onlyOneRun ? 'it' : 'each'} is refused when it comes due unless the workflow is resumed first.`;
}

function listedInWords(count: number, workflow: string): string {
  const listed = `Listed ${counted(count, runNoun)} ${ofTheWorkflow(workflow)}`;
  return count === 1
    ? `${listed} that is queued to start.`
    : `${listed} that are queued to start, in the order they come due.`;
}

function queuedInWords(
  { status, queued_starts: starts, has_more: hasMore }: QueuedStartsPageAnswered,
  asked: Asked,
): string {
  if (starts.length === 0) {
    return `No ${asked.cursor === undefined ? '' : 'more '}runs ${ofTheWorkflow(asked.workflow)} are queued to start.`;
  }
  const more = hasMore ? moreRemain : '';
  const paused = status === 'paused' ? refusedWhilePaused(starts.length === 1 && !hasMore) : '';
  return `${listedInWords(starts.length, asked.workflow)}${more}${paused}`;
}

export function defineListQueuedStarts(queued: Pick<QueuedStartReads, 'queuedStartsPage'>) {
  return defineQuery('playbook', {
    name: 'list_queued_starts',
    title: 'List queued starts',
    description,
    route: { method: 'GET', path: '/definitions/workflow/{workflow}/queued-starts' },
    inputSchema: Schema.Struct({
      workflow: Schema.String.annotate({
        description: "The workflow's name: 3 to 48 lowercase letters, digits and hyphens, starting with a letter",
      }).check(Schema.isPattern(definitionNamePattern)),
      limit: EventPagingInputFields.limit,
      cursor: EventPagingInputFields.cursor,
    }),
    outputSchema: QueuedStartsPageSchema,
    reasons: ['not_found', 'invalid_input'],
    handle: Effect.fnUntraced(function* ({ workflow, limit = defaultPageLimit, cursor }) {
      const after = yield* afterOf(cursor);
      const { filed, status } = yield* workflowNamed(workflow);
      const asked = after === undefined ? { limit } : { after, limit };
      const { starts, more } = yield* queued.queuedStartsPage(filed, asked);
      return {
        status,
        queued_starts: starts.map((start) => shownOf(start)),
        has_more: more,
        next_cursor: cursorAfter(starts, more),
      };
    }),
    plainLanguage: {
      task: 'list the queued starts of a workflow',
      attempt: ({ workflow }) => `list the runs ${ofTheWorkflow(workflow)} that are queued to start`,
      outcome: queuedInWords,
    },
  });
}

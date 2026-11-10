import {
  PlaybookContext,
  PlaybookReader,
  NotFound,
  ServedAsTool,
  WholeEventSchema,
  defineQuery,
  keptContentOf,
  mostToolFieldBytes,
  playbookPayloadReader,
  presentationOf,
  stepIdSeparator,
  streamPrefixOfPlaybook,
  type ContentHolders,
  type KeptContent,
  type Presentation,
  type Presenter,
  type RecordedFact,
  type Showing,
} from '@on.auto/operations';
import { mostPayloadBytesReadAtOnce, payloadReadsAtOnce, payloadsNamed } from '@on.auto/operations/payloads';
import { Effect, Schema, SchemaTransformation } from 'effect';

import { eventFound } from '../plain-language/feed-words.ts';

const description = [
  'Reads one event of the playbook whole by its id, as list_playbook_events shows it: its fact as data and its metadata, every field whole,',
  "with a tool call's arguments, the tool's result as it answered and the answer document read from it.",
  `Over MCP an input, output, record, answer, arguments, result or event data past ${mostToolFieldBytes} bytes appears as its size; over HTTP every field is whole.`,
  'Use it to open what a tool answered, or a large input or output, that a page of events shows as its size.',
  "`event_id` is the event's id: a UUID, or for a workflow's step its record's id, an underscore and its number.",
].join(' ');

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_[1-9]\d{0,5})?$/u;

const EventIdField = Schema.String.annotate({
  description: "The event's id: a UUID, or a step's record id followed by an underscore and the step's number",
})
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()))
  .check(
    Schema.makeFilter((id: string) => eventIdPattern.test(id), {
      expected: 'the id of an event: a UUID, or a UUID, an underscore and a number from 1',
    }),
  );

const GetEventInput = Schema.Struct({ event_id: EventIdField });

function noEventCalled(id: string): NotFound {
  return new NotFound({ detail: `The playbook holds no event ${id}` });
}

function recordIdOf(id: string): string {
  const end = id.indexOf(stepIdSeparator);
  return end === -1 ? id : id.slice(0, end);
}

type TextsRead = readonly (readonly [string, string])[];

type Digested = ReturnType<typeof payloadsNamed>[number];

const shownAsItsFactHoldsIt = () => Effect.succeed<TextsRead>([]);

function payloadsShownOf(
  presentation: Presentation,
  record: RecordedFact,
  showing: Showing,
  kept: readonly Digested[],
) {
  const asked = new Set<string>();
  presentation.present(record, {
    ...showing,
    content: (sha256) => {
      asked.add(sha256);
      return showing.content(sha256);
    },
  });
  return kept.filter(({ sha256 }) => asked.has(sha256));
}

const payloadTextsOf = Effect.fnUntraced(function* (shown: readonly Digested[]) {
  const payloads = yield* playbookPayloadReader;
  const texts = yield* Effect.forEach(
    shown,
    ({ sha256, bytes }) =>
      payloads.text({ sha256, bytes }).pipe(
        Effect.map((text): TextsRead => [[sha256, text]]),
        Effect.catchTags({ payload_missing: shownAsItsFactHoldsIt, payload_erased: shownAsItsFactHoldsIt }),
      ),
    { concurrency: payloadReadsAtOnce },
  );
  return new Map(texts.flat());
});

function joined(payloadTexts: ReadonlyMap<string, string>, content: KeptContent): KeptContent {
  return (sha256) => payloadTexts.get(sha256) ?? content(sha256);
}

function eventReader(presentation: Presentation, holders: ContentHolders) {
  return Effect.fnUntraced(function* ({ event_id: id }: typeof GetEventInput.Type) {
    const record = yield* (yield* PlaybookReader).readRecordedEvent(recordIdOf(id));
    if (record === undefined) {
      return yield* Effect.fail(noEventCalled(id));
    }
    const view = (yield* ServedAsTool) ? 'tool' : 'whole';
    const mostBytes = view === 'tool' ? mostToolFieldBytes : mostPayloadBytesReadAtOnce;
    const kept = payloadsNamed(record.data, holders.get(record.type) ?? {}).filter(({ bytes }) => bytes <= mostBytes);
    const showing: Showing = {
      streamPrefix: streamPrefixOfPlaybook(yield* PlaybookContext),
      content: yield* keptContentOf([record], Number.POSITIVE_INFINITY, holders),
      view,
    };
    const payloadTexts = yield* payloadTextsOf(payloadsShownOf(presentation, record, showing, kept));
    const event = presentation
      .present(record, { ...showing, content: joined(payloadTexts, showing.content) })
      .find((shown) => shown.id === id);
    return event ?? (yield* Effect.fail(noEventCalled(id)));
  });
}

export function defineGetEvent(presenters: readonly Presenter[], holders: ContentHolders) {
  return defineQuery('playbook', {
    name: 'get_event',
    title: 'Get event',
    description,
    route: { method: 'GET', path: '/events/{event_id}' },
    inputSchema: GetEventInput,
    outputSchema: WholeEventSchema,
    reasons: ['not_found', 'invalid_input', 'unavailable'],
    handle: eventReader(presentationOf(presenters), holders),
    plainLanguage: {
      task: 'read one event of the playbook',
      attempt: ({ event_id: id }) => `read the event ${id}`,
      outcome: eventFound,
    },
  });
}

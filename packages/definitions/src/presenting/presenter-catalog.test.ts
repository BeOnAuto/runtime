import {
  type Context,
  type Decided,
  type IncompleteReason,
  type KeptContent,
  mostPublicEventDataBytes,
  presentationOf,
  PublicEventSchema,
  type RecordedEvent,
  streamKindOf,
} from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { Result, Schema, SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { type EventPublished, publishedEventDecider, publishedEventStreamOf } from '../events/published-events.ts';
import { makeDefinitionPresenters } from '../index.ts';
import { definitionDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { mostInputBytes, mostResultBytes } from '../runs/recorded-size.ts';
import { coreRunFactTypes, type RunEvent } from '../runs/run-events.ts';
import { recordedAdmin, startedInAlpha } from '../testing/callers.ts';
import { asking, echo } from '../testing/index.ts';
import { testRunId } from '../testing/run-facts.ts';
import { cutAtCodePoint, issuesShown } from './event-data.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const longestType = 'p'.repeat(32);

const runStream = `runs/${runId}`;

const definitionStream = definitionTypeStreamOf(longestType);

const definitionsOfTheLongestType = definitionDecider(longestType, { org: 'acme', playbook: 'alpha' }, runId);

const eventStream = publishedEventStreamOf('/ledger/eu', 'm-1');

type DefinitionEvent = Decided<typeof definitionsOfTheLongestType.eventSchema.Type>;

function storedTypesOf(ast: SchemaAST.AST): readonly string[] {
  const members = SchemaAST.isUnion(ast) ? ast.types : [ast];
  return members.flatMap((member) =>
    SchemaAST.isObjects(member)
      ? member.propertySignatures.flatMap(({ name, type }) =>
          name === 'type' && SchemaAST.isLiteral(type) ? [String(type.literal)] : [],
        )
      : [],
  );
}

const catalog = [
  { stream: runStream, storedTypes: [...coreRunFactTypes, 'nudge_sent'] },
  {
    stream: definitionStream,
    storedTypes: [...storedTypesOf(definitionsOfTheLongestType.eventSchema.ast), 'playbook_page_saved'],
  },
  { stream: eventStream, storedTypes: storedTypesOf(publishedEventDecider.eventSchema.ast) },
  { stream: 'nudges/1', storedTypes: ['nudge_read'] },
] as const;

const presenters = makeDefinitionPresenters([echo, asking]);

const { present } = presentationOf(presenters);

const decisionsByKind = new Map(
  presenters.map(({ streamKind, publicNames }) => [streamKind, Object.keys(publicNames).toSorted()]),
);

const awkward = '\u0000'.repeat(64 * 1024);

const context: Context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'acme-admin',
  runId,
  definitionType: longestType,
  definitionName: 'n'.repeat(48),
  definitionVersion: Number.MAX_SAFE_INTEGER,
};

const emittedContext: Context = { ...context, depth: Number.MAX_SAFE_INTEGER };

const largestJson = { text: 'x'.repeat(mostResultBytes - 16) };

const manyIssues = Array.from({ length: 100 }, () => ({ detail: awkward, pointer: awkward }));

const largestCall = {
  number: Number.MAX_SAFE_INTEGER,
  call_id: awkward,
  server: awkward,
  tool: awkward,
  arguments_bytes: Number.MAX_SAFE_INTEGER,
  arguments_sha256: awkward,
};

const largestAnswer = {
  number: Number.MAX_SAFE_INTEGER,
  result_bytes: Number.MAX_SAFE_INTEGER,
  result_sha256: awkward,
  duration_ms: Number.MAX_SAFE_INTEGER,
  jsonrpc_id: awkward,
  server_request_id: awkward,
};

const largestReply = { id: awkward, sender: awkward };

const largestCause = {
  step: awkward,
  run_id: awkward,
  status: 'unreachable',
  reason: 'invalid_input',
  kind: 'blocked_by_moderation',
  because: 'tool_server_not_configured',
} as const;

const largestRunEvents: readonly RunEvent[] = [
  {
    type: 'run_started',
    data: { ...startedInAlpha, input: { text: 'x'.repeat(mostInputBytes - 16) } },
  },
  { type: 'run_succeeded', data: { output: largestJson, record: largestJson } },
  {
    type: 'run_rejected',
    data: { rejection: { reason: 'invalid_input', detail: awkward, issues: manyIssues }, record: largestJson },
  },
  {
    type: 'run_rejected',
    data: {
      rejection: { reason: 'invalid_input', detail: awkward, issues: manyIssues, cause: largestCause },
      record: largestJson,
    },
  },
  {
    type: 'run_rejected',
    data: {
      rejection: {
        reason: 'unavailable',
        detail: awkward,
        kind: 'model_not_offered',
        because: 'provider_not_configured',
      },
    },
  },
  {
    type: 'run_rejected',
    data: {
      rejection: {
        reason: 'unavailable',
        detail: awkward,
        kind: 'model_not_offered',
        because: 'provider_not_configured',
        cause: largestCause,
      },
    },
  },
  { type: 'run_rejected', data: { rejection: { reason: 'conflict', detail: awkward } } },
  { type: 'run_failed', data: { incident: awkward } },
  { type: 'run_cancel_requested', data: { kind: 'requested', reason: awkward } },
  { type: 'tool_call_started', data: largestCall },
  { type: 'tool_call_answered', data: { ...largestAnswer, is_error: true } },
  {
    type: 'tool_call_failed',
    data: {
      number: 1,
      because: 'server_failure',
      detail: awkward,
      duration_ms: 1,
      jsonrpc_id: awkward,
      server_request_id: awkward,
    },
  },
  {
    type: 'request_answered',
    data: { answer: largestJson, claimed_for: awkward, reply: largestReply, answered_by: recordedAdmin },
  },
];

const largestContent = {
  source: '😀'.repeat(16 * 1024),
  overview: '😀'.repeat(4 * 1024),
  description: awkward,
  input_schema: largestJson,
  output_schema: largestJson,
  warnings: Array.from({ length: 10_000 }, () => awkward.slice(0, 100)),
};

const largestDefinitionEvents: readonly DefinitionEvent[] = [
  { type: 'definition_created', data: { content: largestContent, created_by: recordedAdmin } },
  { type: 'definition_updated', data: { content: largestContent } },
  { type: 'definition_retired', data: {} },
];

const awkwardText = (most: number) => '"'.repeat(most);

const largestEventPublished: EventPublished = {
  type: 'event_published',
  data: {
    event: {
      specversion: '1.0',
      id: awkwardText(256),
      source: 'x'.repeat(1024),
      type: awkwardText(256),
      subject: awkwardText(1024),
      time: '2026-10-01T09:00:00.123456789+02:00',
      data: { text: 'x'.repeat(200 * 1024) },
    },
    filled: ['id', 'time'],
  },
};

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const utf8 = new TextEncoder();

const showing = { streamPrefix: 'playbook/acme/alpha/', content: () => awkward, view: 'page' } as const;

function recordOf(
  stream: string,
  type: string,
  data: unknown,
  recordedPresenterCatalog: Context = context,
): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context: recordedPresenterCatalog,
    recordedAt: recordedPresenterCatalog.at,
  };
}

function presentedSizeOf(record: RecordedEvent): readonly [bytes: number, conforms: boolean] {
  const [presentedPresenterCatalog] = present(record, showing);
  return [
    utf8.encode(JSON.stringify(presentedPresenterCatalog?.data)).byteLength,
    Result.isSuccess(decodePublicEvent(presentedPresenterCatalog)),
  ];
}

const someWords: unknown = expect.any(String);

const { present: presentInLimitsPresented } = presentationOf(makeDefinitionPresenters([echo]));

const ofGreet: Context = {
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:01.000Z',
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 2,
};

const kept: Readonly<Record<string, string>> = {};

const nothingKeptLimitsPresented: KeptContent = (sha256) => kept[sha256];

function presented(eventLimitsPresented: RunEvent) {
  const recordedLimitsPresented = {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
    correlationId: testRunId,
    stream: `runs/${testRunId}`,
    version: 1,
    globalPosition: 11,
    type: eventLimitsPresented.type,
    data: eventLimitsPresented.data,
    context: ofGreet,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
  return presentInLimitsPresented(recordedLimitsPresented, {
    streamPrefix: 'playbook/acme/alpha/',
    content: nothingKeptLimitsPresented,
    view: 'page',
  }).at(0);
}

function answeredAt(reasonLimitsPresented: IncompleteReason) {
  return presented({
    type: 'run_succeeded',
    data: { output: 'Hello', record: {}, incomplete_details: { reason: reasonLimitsPresented } },
  });
}

const stopped = { reason: 'conflict', detail: 'The run stopped at a limit' } as const;

function wordsNaming(text: string): unknown {
  return expect.stringContaining(text);
}

const { present: presentInPublishedEventPresenter } = presentationOf(makeDefinitionPresenters([echo]));

function recordOfPublishedEventPresenter(
  stream: string,
  type: string,
  data: unknown,
  contextPublishedEventPresenter: Context,
): RecordedEvent {
  return {
    id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context: contextPublishedEventPresenter,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

const showingPublishedEventPresenter = {
  streamPrefix: 'playbook/acme/alpha/',
  content: nothingKept,
  view: 'page',
} as const;

const event = {
  specversion: '1.0' as const,
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  source: 'https://acme.example/ledger',
  type: 'com.acme.ledger.opened',
  time: '2026-10-01T09:00:01.000Z',
};

function presentedPublishedEventPresenter(published: EventPublished, contextPublishedEventPresenter: Context) {
  const stream = publishedEventStreamOf(published.data.event.source, published.data.event.id);
  return presentInPublishedEventPresenter(
    recordOfPublishedEventPresenter(stream, published.type, published.data, contextPublishedEventPresenter),
    showingPublishedEventPresenter,
  );
}

const publishedBy: Context = { at: '2026-10-01T09:00:01.000Z', by: 'acme-admin' };

const reason =
  'An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach';

const { present: presentInRunToolAnswers } = presentationOf(makeDefinitionPresenters([echo]));

const fileOfRows = { uri: 'file:///rows.json', mimeType: 'application/json', text: '{"rows":[]}' };

const keptRunToolAnswers: Readonly<Record<string, string>> = {
  ['c'.repeat(64)]: JSON.stringify({
    content: [
      { type: 'text', text: 'Read rows.json.' },
      { type: 'resource', resource: fileOfRows },
    ],
  }),
};

const answered = {
  number: 3,
  is_error: false,
  result_bytes: 112,
  result_sha256: 'c'.repeat(64),
  shown_format: 2,
  duration_ms: 120,
  jsonrpc_id: 7,
};

const recorded: RecordedEvent = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d4',
  cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjIiXQ',
  causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
  correlationId: testRunId,
  stream: `runs/${testRunId}`,
  version: 4,
  globalPosition: 12,
  type: 'tool_call_answered',
  data: answered,
  context: {
    runId: testRunId,
    by: 'acme-admin',
    at: '2026-10-01T09:00:01.000Z',
    definitionType: 'echo',
    definitionName: 'greet',
    definitionVersion: 2,
  },
  recordedAt: '2026-10-01T09:00:02.000Z',
};

describe('the presenters of the stream kinds of a playbook', () => {
  it.each(catalog)('decide on every stored type of the events of $stream', ({ stream, storedTypes }) => {
    expect(decisionsByKind.get(streamKindOf(stream))).toEqual(storedTypes.toSorted());
  });

  it('hide a stream kind none of them presents, and a fact of a run no capability of the playbook declares', () => {
    expect([
      present(recordOf(`run-logs/${runId}`, 'run_failed', {}), showing),
      present(recordOf(runStream, 'delivery_started', { number: 1 }), showing),
    ]).toEqual([[], []]);
  });

  it('present the facts a capability declares, on its runs and in the stream kinds it owns, in its words', () => {
    expect([
      ...present(recordOf(runStream, 'nudge_sent', { number: 2 }), showing),
      ...present(recordOf('nudges/1', 'nudge_read', {}), showing),
    ]).toMatchObject([
      { type: 'nudge_sent', summary: 'Nudge 2 was sent.', data: { number: 2 } },
      { type: 'nudge_read', summary: 'A nudge was read.' },
    ]);
  });
});

describe('the largest record of every stored type', () => {
  it.each(
    largestRunEvents.map((eventPresenterCatalog) => [eventPresenterCatalog.type, eventPresenterCatalog] as const),
  )('of a run, %s, presents within the bound of public data', (type, eventPresenterCatalog) => {
    const [bytes, conforms] = presentedSizeOf(recordOf(runStream, type, eventPresenterCatalog.data));

    expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(conforms).toBe(true);
  });

  it.each(
    largestDefinitionEvents.map(
      (eventPresenterCatalog) => [eventPresenterCatalog.type, eventPresenterCatalog] as const,
    ),
  )(
    'of the definitions of a capability, %s, presents within the bound of public data',
    (type, eventPresenterCatalog) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(definitionStream, type, eventPresenterCatalog.data));

      expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(conforms).toBe(true);
    },
  );

  it('of an event published to the playbook presents within the bound of public data', () => {
    const [bytes, conforms] = presentedSizeOf(
      recordOf(eventStream, largestEventPublished.type, largestEventPublished.data, emittedContext),
    );

    expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(conforms).toBe(true);
  });
});

describe('a text cut at a code point', () => {
  it('keeps a text that fits whole', () => {
    expect(cutAtCodePoint('fits', 4)).toBe('fits');
  });

  it('keeps the longest start that fits as JSON in UTF-8, never splitting a character', () => {
    expect([
      cutAtCodePoint('abcdef', 4),
      cutAtCodePoint('ééé', 5),
      cutAtCodePoint('a😀b', 4),
      cutAtCodePoint('a😀b', 5),
      cutAtCodePoint('a\u0000b', 6),
      cutAtCodePoint('a\u0000b', 7),
      cutAtCodePoint('"quoted"', 3),
    ]).toEqual(['abcd', 'éé', 'a', 'a😀', 'a', 'a\u0000', '"q']);
  });
});

describe('the issues shown of a rejection', () => {
  it('are counted, and the first five shown, each detail and pointer cut', () => {
    const issues = Array.from({ length: 7 }, (_, index) => ({
      detail: `${index}${'d'.repeat(300)}`,
      pointer: `/${'p'.repeat(200)}`,
    }));

    expect(issuesShown(issues)).toEqual({
      issue_count: 7,
      issues: ['0', '1', '2', '3', '4'].map((index) => ({
        detail: `${index}${'d'.repeat(255)}`,
        pointer: `/${'p'.repeat(127)}`,
      })),
    });
  });
});

describe('the presenter of a run whose answer a limit shaped', () => {
  it('presents the success with the limit it reached, in words that count nothing', () => {
    expect([answeredAt('max_tool_calls'), answeredAt('max_input_tokens'), answeredAt('max_output_tokens')]).toEqual([
      expect.objectContaining({
        summary: someWords,
        data: { output: 'Hello', record: {}, incomplete_details: { reason: 'max_tool_calls' } },
      }),
      expect.objectContaining({
        summary: someWords,
        data: { output: 'Hello', record: {}, incomplete_details: { reason: 'max_input_tokens' } },
      }),
      expect.objectContaining({
        summary: 'A run finished with an answer cut off at its length limit.',
        data: { output: 'Hello', record: {}, incomplete_details: { reason: 'max_output_tokens' } },
      }),
    ]);
  });
});

describe('the presenter of a run stopped at a limit before it finished', () => {
  it('shows the limit as its because, and says why in words that count nothing', () => {
    expect([
      presented({
        type: 'run_rejected',
        data: { rejection: { ...stopped, kind: 'unworkable', because: 'max_tool_calls' } },
      }),
      presented({
        type: 'run_rejected',
        data: { rejection: { ...stopped, kind: 'effect_unknown', because: 'max_input_tokens' } },
      }),
    ]).toEqual([
      expect.objectContaining({
        summary: someWords,
        data: { ...stopped, kind: 'unworkable', because: 'max_tool_calls' },
      }),
      expect.objectContaining({
        summary: someWords,
        data: { ...stopped, kind: 'effect_unknown', because: 'max_input_tokens' },
      }),
    ]);
  });
});

describe('the presenter of a published event', () => {
  it('shows its id, type, source and time, and leaves out a subject and data it does not have', () => {
    expect(
      presentedPublishedEventPresenter(
        { type: 'event_published', data: { event, filled: ['id', 'time'] } },
        publishedBy,
      ),
    ).toMatchObject([
      {
        type: 'event_published',
        summary: wordsNaming('“com.acme.ledger.opened”'),
        data: {
          event_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
          event_type: 'com.acme.ledger.opened',
          source: 'https://acme.example/ledger',
          time: '2026-10-01T09:00:01.000Z',
          filled: ['id', 'time'],
        },
        metadata: { by: 'acme-admin' },
      },
    ]);
  });

  it('shows its subject and its data within 2 KiB, its data past it as its size, and the workflow that emitted it', () => {
    const emitted: Context = {
      ...publishedBy,
      runId: 'r-1',
      definitionType: 'workflow',
      definitionName: 'close',
      definitionVersion: 2,
      depth: 1,
    };
    const withData = { ...event, subject: 'september', data: { region: 'eu' } };

    expect([
      ...presentedPublishedEventPresenter({ type: 'event_published', data: { event: withData, filled: [] } }, emitted),
      ...presentedPublishedEventPresenter(
        { type: 'event_published', data: { event: { ...event, data: 'x'.repeat(3000) }, filled: [] } },
        publishedBy,
      ),
    ]).toMatchObject([
      {
        summary: wordsNaming('“close”'),
        data: { subject: 'september', data: { region: 'eu' } },
        metadata: { run_id: 'r-1', depth: 1, definition: { type: 'workflow', name: 'close', version: 2 } },
      },
      { data: { data_bytes: 3002 } },
    ]);
  });
});

describe('the presenter of the refused reactions of a workflow', () => {
  it('says in words that the workflow of its context was not started every time its triggers called for it, and gives the count and the last reason, with its kind, because and trigger where it has them', () => {
    const contextPublishedEventPresenter = {
      at: '2026-10-01T09:01:00.000Z',
      by: 'playbook:alpha',
      definitionType: 'workflow',
      definitionName: 'close-the-month',
      definitionVersion: 2,
    };
    const data = { count: 3, reason, minute: '2026-10-01T09:00:00.000Z' };

    const coded = {
      ...data,
      kind: 'credits_exhausted',
      because: 'free_daily_limit',
      trigger: { kind: 'every', reference: '/schedule/every' },
    };

    expect(
      presentInPublishedEventPresenter(
        recordOfPublishedEventPresenter(
          'reactions/close-the-month',
          'reaction_refused',
          data,
          contextPublishedEventPresenter,
        ),
        showingPublishedEventPresenter,
      ),
    ).toMatchObject([
      {
        type: 'reaction_refused',
        summary: wordsNaming('“close-the-month”'),
        data,
        metadata: { definition: { type: 'workflow', name: 'close-the-month', version: 2 } },
      },
    ]);
    expect(
      presentInPublishedEventPresenter(
        recordOfPublishedEventPresenter(
          'reactions/close-the-month',
          'reaction_refused',
          coded,
          contextPublishedEventPresenter,
        ),
        showingPublishedEventPresenter,
      ),
    ).toMatchObject([{ type: 'reaction_refused', data: coded }]);
  });
});

describe('the presenter of the end of a tool call whose answer carried a file', () => {
  it('presents the answer a reader reads of it, the text of the file after the line before it, and the format its call names', () => {
    const shown = presentInRunToolAnswers(recorded, {
      streamPrefix: 'playbook/acme/alpha/',
      content: (sha256) => keptRunToolAnswers[sha256],
      view: 'page',
    }).at(0);

    expect(shown).toMatchObject({
      summary: 'Tool call 3 answered.',
      data: { ...answered, answer: 'Read rows.json.\n{"rows":[]}' },
    });
  });
});

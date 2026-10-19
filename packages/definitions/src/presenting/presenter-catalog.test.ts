import {
  PublicEventSchema,
  mostPublicEventDataBytes,
  presentationOf,
  streamKindOf,
  type Context,
  type Decided,
  type RecordedEvent,
} from '@on.auto/operations';
import { Result, Schema, SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { publishedEventDecider, publishedEventStreamOf, type EventPublished } from '../events/published-events.ts';
import { makeDefinitionPresenters } from '../index.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { mostInputBytes, mostResultBytes } from '../runs/recorded-size.ts';
import { coreRunFactTypes, type RunEvent } from '../runs/run-events.ts';
import { asking, echo, overviewTitled } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const longestType = 'p'.repeat(32);

const runStream = `runs/${runId}`;

const definitionStream = definitionTypeStreamOf(longestType);

const definitionsOfTheLongestType = definitionsDecider(longestType);

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
  { stream: definitionStream, storedTypes: storedTypesOf(definitionsOfTheLongestType.eventSchema.ast) },
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

const largestRunEvents: readonly RunEvent[] = [
  { type: 'run_started', data: { input: { text: 'x'.repeat(mostInputBytes - 16) } } },
  { type: 'run_succeeded', data: { output: largestJson, record: largestJson } },
  {
    type: 'run_rejected',
    data: { rejection: { reason: 'invalid_input', detail: awkward, issues: manyIssues }, record: largestJson },
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
    data: { answer: largestJson, claimed_for: awkward, reply: largestReply },
  },
];

const largestContent = {
  source: '😀'.repeat(16 * 1024),
  overview: overviewTitled('largest', '😀'.repeat(16 * 1024)),
  description: awkward,
  input_schema: largestJson,
  output_schema: largestJson,
  warnings: Array.from({ length: 10_000 }, () => awkward.slice(0, 100)),
};

const largestDefinitionEvents: readonly DefinitionEvent[] = [
  { type: 'definition_created', data: { content: largestContent } },
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

function recordOf(stream: string, type: string, data: unknown, recorded: Context = context): RecordedEvent {
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
    context: recorded,
    recordedAt: recorded.at,
  };
}

function presentedSizeOf(record: RecordedEvent): readonly [bytes: number, conforms: boolean] {
  const [presented] = present(record, showing);
  return [utf8.encode(JSON.stringify(presented?.data)).byteLength, Result.isSuccess(decodePublicEvent(presented))];
}

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
  it.each(largestRunEvents.map((event) => [event.type, event] as const))(
    'of a run, %s, presents within the bound of public data',
    (type, event) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(runStream, type, event.data));

      expect(bytes).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(conforms).toBe(true);
    },
  );

  it.each(largestDefinitionEvents.map((event) => [event.type, event] as const))(
    'of the definitions of a capability, %s, presents within the bound of public data',
    (type, event) => {
      const [bytes, conforms] = presentedSizeOf(recordOf(definitionStream, type, event.data));

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

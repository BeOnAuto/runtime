import {
  recordedDecoder,
  streamKindOf,
  type DefinitionContext,
  type RecordedFact,
  type RunContext,
} from '@on.auto/operations';
import { outputPayloadOf, type Payload, type PayloadNotRead, type PayloadReader } from '@on.auto/operations/payloads';
import { Effect, Option, type Schema } from 'effect';

import { DefinitionEventSchema, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { jsonBytesOf, nestsWithin } from '../runs/recorded-size.ts';
import { RunEventSchema, type RecordedRunEvent, type RecordedRunFact } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import { mostEventDataDepth, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { EventPublishedSchema } from './published-events.ts';
import { runSourcePrefix, definitionSourcePrefix } from './reserved-attributes.ts';

type RunFact = RecordedRunFact<'run_started' | 'run_succeeded' | 'run_rejected' | 'run_failed'>;

type Extensions = Readonly<Record<string, string | number>>;

const runFactTypes: readonly RunFact['type'][] = ['run_started', 'run_succeeded', 'run_rejected', 'run_failed'];

const decodeRunEvent = recordedDecoder(RunEventSchema);

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

const decodePublished = recordedDecoder(EventPublishedSchema);

const publishedEventsKind = 'events';

function isPlaybookRunEventType(type: string): boolean {
  return runFactTypes.some((runType) => runType === type);
}

function isRunFact(event: RecordedRunEvent): event is RunFact {
  return isPlaybookRunEventType(event.type);
}

type FactContext = DefinitionContext & Partial<Pick<RunContext, 'depth' | 'callDepth' | 'calledBy' | 'trigger'>>;

function triggerOf({ trigger }: FactContext): Extensions {
  return trigger === undefined ? {} : { triggerkind: trigger.kind, triggerreference: trigger.reference };
}

function extensionsOf(context: FactContext): Extensions {
  const { by, definitionVersion, depth, callDepth, calledBy } = context;
  return {
    caller: by,
    definitionversion: definitionVersion,
    ...(depth === undefined ? {} : { depth }),
    ...(callDepth === undefined ? {} : { calldepth: callDepth }),
    ...(calledBy === undefined ? {} : { calledby: calledBy.runId }),
    ...triggerOf(context),
  };
}

function withOutput(fact: CloudEvent, output: Schema.Json): CloudEvent {
  const whole = { ...fact, data: { output } };
  return jsonBytesOf(whole) <= mostPublishedEventBytes && nestsWithin(whole.data, mostEventDataDepth)
    ? whole
    : { ...fact, data: { output_bytes: jsonBytesOf(output) } };
}

const bytesOfNull = jsonBytesOf(null);

function mayCarryItsOutput(fact: CloudEvent, bytes: number): boolean {
  return jsonBytesOf({ ...fact, data: { output: null } }) - bytesOfNull + bytes <= mostPublishedEventBytes;
}

function withItsSize(fact: CloudEvent, bytes: number): CloudEvent {
  return { ...fact, data: { output_bytes: bytes } };
}

function withOutputAsRecorded(fact: CloudEvent, output: Payload<Schema.Json>): CloudEvent {
  return 'inline' in output ? withOutput(fact, output.inline) : withItsSize(fact, output.kept.bytes);
}

function withOutputRead(
  fact: CloudEvent,
  output: Payload<Schema.Json>,
  payloads: PayloadReader,
): Effect.Effect<CloudEvent, PayloadNotRead> {
  if ('inline' in output || !mayCarryItsOutput(fact, output.kept.bytes)) {
    return Effect.succeed(withOutputAsRecorded(fact, output));
  }
  return Effect.map(payloads.json(output.kept), (value) => withOutput(fact, value));
}

function rejectionOf(rejection: RunRejection): Schema.JsonObject {
  const kind = 'kind' in rejection ? rejection.kind : undefined;
  return kind === undefined ? { reason: rejection.reason } : { reason: rejection.reason, kind };
}

function bareRunFactOf(id: string, run: string, { type, context }: RunFact): CloudEvent {
  return {
    specversion: '1.0',
    id,
    source: `${runSourcePrefix}${run}`,
    type,
    subject: `${context.definitionType}/${context.definitionName}`,
    time: context.at,
    ...extensionsOf(context),
  };
}

function runFactOf(id: string, run: string, event: RunFact): CloudEvent {
  const fact = bareRunFactOf(id, run, event);
  if (event.type === 'run_succeeded') {
    return withOutputAsRecorded(fact, outputPayloadOf(event));
  }
  return event.type === 'run_rejected' ? { ...fact, data: rejectionOf(event.data.rejection) } : fact;
}

function runFactRead(id: string, run: string, event: RunFact, payloads: PayloadReader) {
  return event.type === 'run_succeeded'
    ? withOutputRead(bareRunFactOf(id, run, event), outputPayloadOf(event), payloads)
    : Effect.succeed(runFactOf(id, run, event));
}

function definitionFactOf(id: string, definitionType: string, { type, context }: RecordedDefinitionEvent): CloudEvent {
  return {
    specversion: '1.0',
    id,
    source: `${definitionSourcePrefix}${definitionType}/${context.definitionName}`,
    type,
    time: context.at,
    ...extensionsOf(context),
  };
}

type RecordedFactRead =
  | { readonly definition: RecordedDefinitionEvent; readonly named: string }
  | { readonly run: RunFact; readonly named: string };

function factReadOf(record: RecordedFact): RecordedFactRead | undefined {
  const kind = streamKindOf(record.stream);
  const named = record.stream.slice(kind.length + 1);
  if (kind === 'definitions') {
    return Option.getOrUndefined(Option.map(decodeDefinitionEvent(record), (definition) => ({ definition, named })));
  }
  const runFact = kind === 'runs' ? Option.filter(decodeRunEvent(record), isRunFact) : Option.none();
  return Option.getOrUndefined(Option.map(runFact, (run) => ({ run, named })));
}

function cloudEventOf(record: RecordedFact): CloudEvent | undefined {
  const read = factReadOf(record);
  if (read === undefined) {
    return undefined;
  }
  return 'definition' in read
    ? definitionFactOf(record.id, read.named, read.definition)
    : runFactOf(record.id, read.named, read.run);
}

function cloudEventRead(record: RecordedFact, payloads: PayloadReader) {
  const read = factReadOf(record);
  return read === undefined || 'definition' in read
    ? Effect.succeed(cloudEventOf(record))
    : runFactRead(record.id, read.named, read.run, payloads);
}

function lineageOf({ causationId, correlationId }: RecordedFact): Readonly<Record<string, string>> {
  return {
    ...(causationId === null ? {} : { causationid: causationId }),
    ...(correlationId === null ? {} : { correlationid: correlationId }),
  };
}

function withLineage(record: RecordedFact, fact: CloudEvent | undefined): CloudEvent | undefined {
  return fact === undefined ? undefined : { ...fact, ...lineageOf(record) };
}

export function playbookFactOf(record: RecordedFact): CloudEvent | undefined {
  return withLineage(record, cloudEventOf(record));
}

export function playbookFactRead(
  record: RecordedFact,
  payloads: PayloadReader,
): Effect.Effect<CloudEvent | undefined, PayloadNotRead> {
  return Effect.map(cloudEventRead(record, payloads), (fact) => withLineage(record, fact));
}

function keptOutputBytesToRead(record: RecordedFact): number {
  const read = factReadOf(record);
  if (read === undefined || 'definition' in read || read.run.type !== 'run_succeeded') {
    return 0;
  }
  const output = outputPayloadOf(read.run);
  return 'inline' in output || !mayCarryItsOutput(bareRunFactOf(record.id, read.named, read.run), output.kept.bytes)
    ? 0
    : output.kept.bytes;
}

function isPublishedEvent(record: RecordedFact): boolean {
  return streamKindOf(record.stream) === publishedEventsKind && record.type === 'event_published';
}

function publishedEventIn(record: RecordedFact): CloudEvent | undefined {
  return Option.getOrUndefined(Option.map(decodePublished(record), ({ data }) => data.event));
}

export function playbookEventOf(record: RecordedFact): CloudEvent | undefined {
  return isPublishedEvent(record) ? publishedEventIn(record) : playbookFactOf(record);
}

export function playbookEventRead(
  record: RecordedFact,
  payloads: PayloadReader,
): Effect.Effect<CloudEvent | undefined, PayloadNotRead> {
  return isPublishedEvent(record) ? Effect.succeed(publishedEventIn(record)) : playbookFactRead(record, payloads);
}

export function playbookEventBytesToRead(record: RecordedFact): number {
  return isPublishedEvent(record) ? 0 : keptOutputBytesToRead(record);
}

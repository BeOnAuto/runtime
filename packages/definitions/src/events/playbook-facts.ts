import {
  recordedDecoder,
  streamKindOf,
  type DefinitionContext,
  type RecordedFact,
  type RunContext,
} from '@on.auto/operations';
import { Option, type Schema } from 'effect';

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

export function isPlaybookRunEventType(type: string): boolean {
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

function rejectionOf(rejection: RunRejection): Schema.JsonObject {
  const kind = 'kind' in rejection ? rejection.kind : undefined;
  return kind === undefined ? { reason: rejection.reason } : { reason: rejection.reason, kind };
}

function runFactOf(id: string, run: string, event: RunFact): CloudEvent {
  const { context } = event;
  const fact: CloudEvent = {
    specversion: '1.0',
    id,
    source: `${runSourcePrefix}${run}`,
    type: event.type,
    subject: `${context.definitionType}/${context.definitionName}`,
    time: context.at,
    ...extensionsOf(context),
  };
  if (event.type === 'run_succeeded') {
    return withOutput(fact, event.data.output);
  }
  return event.type === 'run_rejected' ? { ...fact, data: rejectionOf(event.data.rejection) } : fact;
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

function cloudEventOf(record: RecordedFact): CloudEvent | undefined {
  const { id, stream } = record;
  const kind = streamKindOf(stream);
  const named = stream.slice(kind.length + 1);
  if (kind === 'definitions') {
    return Option.getOrUndefined(
      Option.map(decodeDefinitionEvent(record), (event) => definitionFactOf(id, named, event)),
    );
  }
  const runFact = kind === 'runs' ? Option.filter(decodeRunEvent(record), isRunFact) : Option.none();
  return Option.getOrUndefined(Option.map(runFact, (event) => runFactOf(id, named, event)));
}

function lineageOf({ causationId, correlationId }: RecordedFact): Readonly<Record<string, string>> {
  return {
    ...(causationId === null ? {} : { causationid: causationId }),
    ...(correlationId === null ? {} : { correlationid: correlationId }),
  };
}

export function playbookFactOf(record: RecordedFact): CloudEvent | undefined {
  const fact = cloudEventOf(record);
  return fact === undefined ? undefined : { ...fact, ...lineageOf(record) };
}

export function playbookEventOf(record: RecordedFact): CloudEvent | undefined {
  if (streamKindOf(record.stream) !== publishedEventsKind || record.type !== 'event_published') {
    return playbookFactOf(record);
  }
  return Option.getOrUndefined(Option.map(decodePublished(record), ({ data }) => data.event));
}

import type { CalledBy, Context, StartingTrigger } from '../ledger/context.ts';
import type { EventMetadata } from './public-event.ts';
import type { RecordedFact, Trace } from './recorded-read.ts';

type Chain = Pick<EventMetadata, 'run_id' | 'definition' | 'called_by' | 'call_depth' | 'depth' | 'trigger'>;

function definitionOf({
  definitionType,
  definitionName,
  definitionVersion,
}: Context): Pick<EventMetadata, 'definition'> {
  if (definitionType === undefined || definitionName === undefined) {
    return {};
  }
  const version = definitionVersion === undefined ? {} : { version: definitionVersion };
  return { definition: { type: definitionType, name: definitionName, ...version } };
}

function calledByOf(calledBy: CalledBy | undefined): Pick<Chain, 'called_by'> {
  return calledBy === undefined
    ? {}
    : { called_by: { run_id: calledBy.runId, reference: calledBy.reference, run: calledBy.run } };
}

function triggerOf(trigger: StartingTrigger | undefined): Pick<Chain, 'trigger'> {
  return trigger === undefined ? {} : { trigger: { kind: trigger.kind, reference: trigger.reference } };
}

function chainOf(context: Context): Chain {
  const { runId, calledBy, callDepth, depth, trigger } = context;
  return {
    ...(runId === undefined ? {} : { run_id: runId }),
    ...definitionOf(context),
    ...calledByOf(calledBy),
    ...(callDepth === undefined ? {} : { call_depth: callDepth }),
    ...(depth === undefined ? {} : { depth }),
    ...triggerOf(trigger),
  };
}

function traceOf({ traceId, spanId }: Trace): Pick<EventMetadata, 'trace_id' | 'span_id'> {
  return {
    ...(traceId === undefined ? {} : { trace_id: traceId }),
    ...(spanId === undefined ? {} : { span_id: spanId }),
  };
}

export function eventMetadataOf(recorded: RecordedFact, streamPrefix: string): EventMetadata {
  const { context } = recorded;
  return {
    stream: `${streamPrefix}${recorded.stream}`,
    position: recorded.version,
    global_position: recorded.globalPosition,
    correlation_id: recorded.correlationId,
    causation_id: recorded.causationId,
    at: context.at,
    by: context.by,
    ...chainOf(context),
    ...traceOf(recorded),
  };
}

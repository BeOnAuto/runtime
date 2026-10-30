import { isRunEndingType } from '@on.auto/definitions';
import type { AppendObserver, AppendPlace } from '@on.auto/ledger';
import { messageIdOf } from '@on.auto/operations';
import { context, metrics, type Counter } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const mostDataCharacters = 2048;

type Value = string | number | null | undefined;

type Present = Readonly<Record<string, string | number>>;

function presentOf(candidates: Readonly<Record<string, Value>>): Present {
  return Object.fromEntries(
    Object.entries(candidates).filter(
      (entry: readonly [string, Value]): entry is [string, string | number] =>
        entry[1] !== undefined && entry[1] !== null,
    ),
  );
}

function attributesOf(stream: string, position: number, { context: recorded, lineage }: AppendPlace): Present {
  return presentOf({
    'auto.on.stream': stream,
    'auto.on.position': position,
    'auto.on.message_id': messageIdOf(stream, position),
    'auto.on.by': recorded.by,
    'auto.on.run_id': recorded.runId,
    'auto.on.definition.type': recorded.definitionType,
    'auto.on.definition.name': recorded.definitionName,
    'auto.on.definition.version': recorded.definitionVersion,
    'auto.on.depth': recorded.depth,
    'auto.on.call_depth': recorded.callDepth,
    'auto.on.trigger.kind': recorded.trigger?.kind,
    'auto.on.correlation_id': lineage?.correlationId,
    'auto.on.causation_id': lineage?.causationId,
  });
}

function countedIfEnding(runsEnded: Counter, type: string, { context: recorded }: AppendPlace): void {
  if (isRunEndingType(type)) {
    runsEnded.add(
      1,
      presentOf({ 'auto.on.definition.type': recorded.definitionType, 'auto.on.outcome': type.slice('run_'.length) }),
    );
  }
}

export function recordedEventsOf(content: boolean): AppendObserver {
  const logger = logs.getLogger('@on.auto/ledger');
  const runsEnded = metrics.getMeter('@on.auto/ledger').createCounter('auto.on.runs.ended', {
    description: 'The runs that ended, by the type of their definition and how they ended',
  });
  return {
    appended: (stream, events, place) => {
      const active = context.active();
      for (const [index, event] of events.entries()) {
        const data = JSON.stringify(event.data);
        logger.emit({
          eventName: event.type,
          severityNumber: SeverityNumber.INFO,
          severityText: 'INFO',
          context: active,
          body: event.type,
          attributes: {
            'auto.on.type': event.type,
            ...attributesOf(stream, place.expectedVersion + index + 1, place),
            'auto.on.data_bytes': Buffer.byteLength(data),
            ...(content ? { 'auto.on.data': data.slice(0, mostDataCharacters) } : {}),
          },
        });
        countedIfEnding(runsEnded, event.type, place);
      }
    },
  };
}

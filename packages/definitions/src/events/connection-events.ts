import {
  playbookCallerOf,
  streamPrefixOfPlaybook,
  type Conflict,
  type Ledger,
  type PlaybookAddress,
} from '@on.auto/operations';
import { connectionSourcePrefix } from '@on.auto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import { jsonBytesOf } from '../runs/recorded-size.ts';
import { CloudEventSchema, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { publishedEventDecider, publishedEventStreamOf, type FilledAttribute } from './published-events.ts';

export interface ReportedEvent {
  readonly type: string;
  readonly id: string;
  readonly time?: string;
  readonly subject?: string;
  readonly data: Readonly<Record<string, Schema.Json>>;
  readonly automatic?: boolean;
}

export interface ConnectionPublication {
  readonly event: CloudEvent;
  readonly filled: readonly FilledAttribute[];
}

export type RecordConnectionEvent = (
  playbook: PlaybookAddress,
  publication: ConnectionPublication,
  at: string,
) => Effect.Effect<void, Conflict>;

const decodeEvent = Schema.decodeUnknownOption(CloudEventSchema);

function withinItsBytes(event: CloudEvent): boolean {
  return jsonBytesOf(event) <= mostPublishedEventBytes;
}

export function connectionPublicationOf(
  connection: string,
  { type, id, time, subject, data, automatic }: ReportedEvent,
  at: string,
): ConnectionPublication | undefined {
  const event = {
    specversion: '1.0',
    id,
    source: `${connectionSourcePrefix}${connection}`,
    type,
    time: time ?? at,
    ...(subject === undefined ? {} : { subject }),
    data,
    ...(automatic === true ? { automatic } : {}),
  };
  const filled: readonly FilledAttribute[] = time === undefined ? ['time'] : [];
  return Option.getOrUndefined(
    Option.map(Option.filter(decodeEvent(event), withinItsBytes), (decoded) => ({ event: decoded, filled })),
  );
}

export function connectionEventRecorder(ledger: Pick<Ledger['Service'], 'execute'>): RecordConnectionEvent {
  return (playbook, { event, filled }, at) =>
    Effect.asVoid(
      ledger.execute(
        `${streamPrefixOfPlaybook(playbook)}${publishedEventStreamOf(event.source, event.id)}`,
        publishedEventDecider,
        { event, filled, by: playbookCallerOf(playbook).id, at },
      ),
    );
}

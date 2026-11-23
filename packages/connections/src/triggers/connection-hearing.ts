import { isArranging, pollingIntervalSecondsOf, type EventDestination, type ProviderEntry } from '@on.auto/providers';

import type { RecordedConnection } from '../registry/connection.ts';
import { holdsItUnrefused, labelsOf } from '../sockets/socket-holders.ts';

export interface EventsReceived {
  readonly perSubscription: boolean;
  readonly perApp: boolean;
  readonly socket: boolean;
}

export const nothingReceived: EventsReceived = { perSubscription: false, perApp: false, socket: false };

export type Hearing =
  | { readonly kind: 'heard'; readonly destination: EventDestination }
  | { readonly kind: 'lacking'; readonly label: string }
  | { readonly kind: 'not_heard' };

const notHeard: Hearing = { kind: 'not_heard' };

type HeldCredentials = Pick<RecordedConnection, 'app_credentials'>;

function mapsTheType({ events = [] }: EventDestination, type: string): boolean {
  return events.some((mapped) => mapped.type === type);
}

export function isMadePerApp({ type, per }: EventDestination): boolean {
  return type === 'webhook' && per === 'app';
}

function overItsSocket(connection: HeldCredentials, entry: ProviderEntry, destination: EventDestination) {
  return [destination.credential]
    .filter((credential) => credential !== undefined)
    .flatMap((credential): readonly Hearing[] =>
      holdsItUnrefused(connection, credential)
        ? [{ kind: 'heard', destination }]
        : labelsOf(entry, credential).map((label) => ({ kind: 'lacking', label })),
    );
}

interface Hearer {
  readonly connection: HeldCredentials;
  readonly entry: ProviderEntry;
  readonly received: EventsReceived;
}

function answersOf({ connection, entry, received }: Hearer, destination: EventDestination): readonly Hearing[] {
  const heard: readonly Hearing[] = [{ kind: 'heard', destination }];
  if (destination.type === 'polling') {
    return heard;
  }
  if (destination.type === 'webhook' && isArranging(destination)) {
    return received.perSubscription ? heard : [];
  }
  if (isMadePerApp(destination)) {
    return received.perApp ? heard : [];
  }
  return destination.type === 'websocket' && received.socket ? overItsSocket(connection, entry, destination) : [];
}

export function hearingOf(
  connection: HeldCredentials,
  entry: ProviderEntry,
  received: EventsReceived,
  type: string,
): Hearing {
  const hearer = { connection, entry, received };
  const answers = (entry.events?.destinations ?? [])
    .filter((destination) => mapsTheType(destination, type))
    .flatMap((destination) => answersOf(hearer, destination));
  return answers.find(({ kind }) => kind === 'heard') ?? answers.find(({ kind }) => kind === 'lacking') ?? notHeard;
}

export type HeardSpeed =
  | { readonly speed: 'instant' }
  | { readonly speed: 'polling'; readonly polling_interval_seconds: number };

export function speedOf(hearing: Hearing): HeardSpeed {
  return hearing.kind === 'heard' && hearing.destination.type === 'polling'
    ? { speed: 'polling', polling_interval_seconds: pollingIntervalSecondsOf(hearing.destination) }
    : { speed: 'instant' };
}

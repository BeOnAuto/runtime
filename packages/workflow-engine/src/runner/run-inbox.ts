import { jsonBytesOf, type JsonObject } from '../dsl/json.ts';
import { raised } from '../dsl/raised-error.ts';
import type { CallKey } from '../executor/call-key.ts';
import type { InboxState } from '../inbox/inbox-state.ts';
import type { ReceivedEvent } from '../inbox/received-event.ts';
import type { DslError } from '../machine/dsl-error.ts';
import {
  mostEmittedEventBytes,
  mostEmittedEvents,
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '../machine/limits.ts';
import type { EmittedEvents } from '../machine/run-state.ts';
import type { Journal } from './run-tables.ts';

export interface EmissionTable {
  readonly emit: (key: CallKey, event: JsonObject) => DslError | undefined;
  readonly emitted: () => EmittedEvents;
}

export type OfferVerdict =
  | { readonly kind: 'accepted'; readonly slot: number }
  | { readonly kind: 'declined' }
  | { readonly kind: 'failed'; readonly error: DslError };

export interface Inbox {
  readonly takeEvent: (accepts: (event: JsonObject) => boolean) => JsonObject | undefined;
  readonly receiveEvent: (event: ReceivedEvent) => DslError | undefined;
  readonly receiveOffer: (key: string, event: ReceivedEvent) => DslError | undefined;
  readonly clear: () => void;
  readonly inbox: () => InboxState;
}

function overflowError(
  received: number,
  receivedBytes: number,
  waiting: number,
  waitingBytes: number,
): DslError | undefined {
  if (received > mostReceivedEvents || receivedBytes > mostReceivedEventBytes) {
    return raised(
      'runtime',
      500,
      `The workflow was sent more than ${mostReceivedEvents} events or ${mostReceivedEventBytes} bytes of events, the most a workflow takes over its life`,
      '/',
    ).error;
  }
  return waiting > mostWaitingEvents || waitingBytes > mostWaitingEventBytes
    ? raised(
        'runtime',
        500,
        `The workflow was sent more events than it consumed: more than ${mostWaitingEvents} events or ${mostWaitingEventBytes} bytes waiting, the most a workflow holds`,
        '/',
      ).error
    : undefined;
}

export function inboxOf(start: InboxState): Inbox {
  const current = {
    ...start,
    waiting: [...start.waiting],
    receivedIds: [...start.receivedIds],
    offeredIds: [...start.offeredIds],
  };
  const counted = (bytes: number, waiting: number): DslError | undefined => {
    const overflow = overflowError(
      current.received + 1,
      current.receivedBytes + bytes,
      current.waiting.length + waiting,
      current.waitingBytes + waiting * bytes,
    );
    if (overflow === undefined) {
      current.received += 1;
      current.receivedBytes += bytes;
    }
    return overflow;
  };
  return {
    takeEvent: (accepts) => {
      const position = current.waiting.findIndex(({ event }) => accepts(event));
      const [taken] = position === -1 ? [] : current.waiting.splice(position, 1);
      current.waitingBytes -= taken?.bytes ?? 0;
      return taken?.event;
    },
    receiveEvent: (event) => {
      const bytes = jsonBytesOf(event);
      const overflow = counted(bytes, 1);
      if (overflow === undefined) {
        current.receivedIds.push(event.id);
        current.waiting.push({ event, bytes });
        current.waitingBytes += bytes;
      }
      return overflow;
    },
    receiveOffer: (key, event) => {
      const overflow = counted(jsonBytesOf(event), 0);
      current.offeredIds.push(...(overflow === undefined ? [key] : []));
      return overflow;
    },
    clear: () => {
      current.waiting = [];
      current.waitingBytes = 0;
    },
    inbox: () => current,
  };
}

function emissionBoundError(reference: string): DslError {
  return raised(
    'runtime',
    500,
    `The workflow emitted more than ${mostEmittedEvents} events or ${mostEmittedEventBytes} bytes of events, the most a workflow emits over its life`,
    reference,
  ).error;
}

export function emissionTableOf(start: EmittedEvents, journal: Journal): EmissionTable {
  const emitted = { ...start };
  return {
    emit: (key, event) => {
      const bytes = jsonBytesOf(event);
      const beyond = emitted.count + 1 > mostEmittedEvents || emitted.bytes + bytes > mostEmittedEventBytes;
      if (!beyond) {
        emitted.count += 1;
        emitted.bytes += bytes;
        journal.emit({ kind: 'emit_event', key, event });
      }
      return beyond ? emissionBoundError(key.reference) : undefined;
    },
    emitted: () => emitted,
  };
}

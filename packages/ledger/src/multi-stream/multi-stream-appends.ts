import type { AppendPlace, EncodedEvent } from '../event-store.ts';

export interface AppendStreamRequest {
  readonly stream: string;
  readonly events: readonly EncodedEvent[];
  readonly place: AppendPlace;
}

export interface MultiStreamAppends {
  readonly multiStreamAppend: (requests: readonly AppendStreamRequest[]) => Promise<void>;
}

export const mostEventsInAMultiStreamAppend = 64;

export const mostBytesInAMultiStreamAppend = 4 * 1024 * 1024;

const utf8 = new TextEncoder();

function bytesOf({ data }: EncodedEvent): number {
  return utf8.encode(JSON.stringify(data)).byteLength;
}

function namedOnce(requests: readonly AppendStreamRequest[]): void {
  const named = new Set<string>();
  for (const { stream } of requests) {
    if (named.has(stream)) {
      throw new RangeError(`A multi-stream append names ${stream} more than once`);
    }
    named.add(stream);
  }
}

function eventsWithin(requests: readonly AppendStreamRequest[], mostEventsInOneAppend: number): void {
  for (const { stream, events } of requests) {
    if (events.length === 0) {
      throw new RangeError(`A multi-stream append gives ${stream} no event`);
    }
    if (events.length > mostEventsInOneAppend) {
      throw new RangeError(
        `A multi-stream append gives ${stream} ${events.length} events, more than ${mostEventsInOneAppend}`,
      );
    }
  }
  const events = requests.reduce((sum, request) => sum + request.events.length, 0);
  if (events > mostEventsInAMultiStreamAppend) {
    throw new RangeError(`A multi-stream append gives ${events} events, more than ${mostEventsInAMultiStreamAppend}`);
  }
}

function bytesWithin(requests: readonly AppendStreamRequest[]): void {
  const bytes = requests.flatMap(({ events }) => events).reduce((sum, event) => sum + bytesOf(event), 0);
  if (bytes > mostBytesInAMultiStreamAppend) {
    throw new RangeError(
      `A multi-stream append gives ${bytes} bytes of event data, more than ${mostBytesInAMultiStreamAppend}`,
    );
  }
}

function byName(one: AppendStreamRequest, other: AppendStreamRequest): number {
  return one.stream < other.stream ? -1 : 1;
}

export function requestsInOrder(
  requests: readonly AppendStreamRequest[],
  mostEventsInOneAppend: number,
): readonly AppendStreamRequest[] {
  if (requests.length === 0) {
    throw new RangeError('A multi-stream append names no stream');
  }
  namedOnce(requests);
  eventsWithin(requests, mostEventsInOneAppend);
  bytesWithin(requests);
  return requests.toSorted(byName);
}

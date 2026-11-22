import type { ConnectionRequested, RecordedConnectionEvent } from './connection-events.ts';
import type { OpenRequest, RecordedConnection } from './connection.ts';

const typesThatChangeNothingButItsRequest: ReadonlySet<string> = new Set([
  'connection_approved',
  'connection_requested',
  'connection_request_declined',
]);

const typesThatEndItsRequest: ReadonlySet<string> = new Set([
  'connection_request_declined',
  'connection_connected',
  'connection_removed',
]);

export function changesNothingButItsRequest(fact: RecordedConnectionEvent): boolean {
  return typesThatChangeNothingButItsRequest.has(fact.type);
}

function requestOf({ data, context }: ConnectionRequested): OpenRequest {
  return { message: data.message ?? null, requested_by: context.by, requested_at: context.at };
}

function requestAfter(request: OpenRequest | null, fact: RecordedConnectionEvent): OpenRequest | null {
  if (fact.type === 'connection_requested') {
    return requestOf(fact);
  }
  return typesThatEndItsRequest.has(fact.type) ? null : request;
}

export function requestedAfter<Kept extends { readonly connection: RecordedConnection }>(
  kept: Kept,
  fact: RecordedConnectionEvent,
): Kept {
  const request = requestAfter(kept.connection.request, fact);
  return request === kept.connection.request ? kept : { ...kept, connection: { ...kept.connection, request } };
}

import type { PlaybookAddress, ProjectionReader, RecordedReader } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowOf, type OpenRequestRow } from '../requests/request-rows.ts';
import { requestRecordOf } from '../run/request-record.ts';

export interface WaitingPlace {
  readonly connection: string;
  readonly conversation: string;
  readonly until: number;
}

export interface RequestPlace {
  readonly request: string;
  readonly provider: string;
  readonly waits?: WaitingPlace;
}

export const requestPlaceFacts: readonly string[] = [
  'delivery_succeeded',
  'request_answered',
  'run_succeeded',
  'run_rejected',
  'run_failed',
];

export interface PlaceParts {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'> & Pick<RecordedReader, 'readRecorded'>;
}

const RecordedRequestSchema = Schema.Struct({ data: Schema.Struct({ record: Schema.Unknown }) });

const readRecorded = Schema.decodeUnknownOption(RecordedRequestSchema);

function rowOf(parts: PlaceParts, playbook: PlaybookAddress, request: string) {
  return Effect.map(
    parts.ledger.readProjectedRows(openRequestsName, playbook, {
      where: [{ column: 'row_key', equals: request }],
      orderBy: ['row_key'],
      order: 'asc',
      limit: 1,
    }),
    ([kept]) => requestRowOf(kept?.row),
  );
}

interface Provided {
  readonly provider: string;
  readonly connection: string;
}

function providedOf(record: unknown): Option.Option<Provided> {
  const request = requestRecordOf(record);
  const provider = request?.provider;
  const connection = request?.deliver?.server;
  return provider === undefined || connection === undefined ? Option.none() : Option.some({ provider, connection });
}

function providedIn(parts: PlaceParts, playbook: PlaybookAddress, request: string) {
  const asked = parts.ledger.readRecorded(
    playbook,
    { kind: 'run', run: request },
    { order: 'desc', limit: 1, types: ['run_deferred'], dataOf: ['run_deferred'] },
  );
  return Effect.map(Effect.orDie(asked), ({ records }) =>
    Option.getOrUndefined(Option.flatMap(readRecorded(records[0]), ({ data }) => providedOf(data.record))),
  );
}

function waitingIn(row: OpenRequestRow, connection: string): WaitingPlace | undefined {
  const { sent_conversation: conversation, conversation: readIn, expires_at: until } = row;
  return row.open && conversation !== null && readIn !== null ? { connection, conversation, until } : undefined;
}

function placeOf(request: string, { provider, connection }: Provided, row: OpenRequestRow): RequestPlace {
  const waits = waitingIn(row, connection);
  return waits === undefined ? { request, provider } : { request, provider, waits };
}

export function requestPlaceOf(
  parts: PlaceParts,
  playbook: PlaybookAddress,
  request: string,
): Effect.Effect<RequestPlace | undefined> {
  return Effect.gen(function* () {
    const row = yield* rowOf(parts, playbook, request);
    const provided = row === undefined ? undefined : yield* providedIn(parts, playbook, request);
    return row === undefined || provided === undefined ? undefined : placeOf(request, provided, row);
  });
}

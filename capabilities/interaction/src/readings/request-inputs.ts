import {
  payloadAsRead,
  payloadsKeptIn,
  recordedRunIn,
  type KeptContentReader,
  type PayloadAsRead,
} from '@on.auto/definitions';
import type { LedgerPorts, StreamReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { KeptRequest } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { readsVariable } from '../tool-blocks/rendered-reads.ts';
import type { RequestInputs } from './request-readings.ts';

export type InputsLedger = StreamReader & Pick<LedgerPorts, 'holderOfStream'> & KeptContentReader;

type InputRead = readonly [string, PayloadAsRead | undefined];

function readsTheInput(request: KeptRequest): boolean {
  return readsVariable(routeOfRequest(request).replies.with, 'input');
}

function inputOfTheRun(ledger: InputsLedger, { playbook, runId }: KeptRequest): Effect.Effect<InputRead> {
  const address = { ...playbook, id: runId };
  return Effect.map(
    Effect.flatMap(recordedRunIn(ledger, address), (recorded) =>
      recorded === undefined
        ? Effect.undefined
        : payloadAsRead(recorded.input, payloadsKeptIn(ledger.content, address)),
    ),
    (read): InputRead => [runId, read],
  );
}

function isUnavailable([, read]: InputRead): boolean {
  return read !== undefined && 'unread' in read && read.unread === 'unavailable';
}

function inputsRead(reads: readonly InputRead[]): RequestInputs {
  return new Map(reads.flatMap(([runId, read]) => (read !== undefined && 'read' in read ? [[runId, read.read]] : [])));
}

export function inputsOf(
  ledger: InputsLedger,
  requests: readonly KeptRequest[],
): Effect.Effect<RequestInputs | undefined> {
  const reading = requests.filter((request) => readsTheInput(request));
  return Effect.map(
    Effect.forEach(reading, (request) => inputOfTheRun(ledger, request)),
    (reads: readonly InputRead[]) => (reads.some((read) => isUnavailable(read)) ? undefined : inputsRead(reads)),
  );
}

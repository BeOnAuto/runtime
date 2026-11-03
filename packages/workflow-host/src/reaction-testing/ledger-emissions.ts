import { eventEmitter, playbookOwnNamesOf, publishedEventOf, type EmitEvent } from '@on.auto/definitions';
import { recordedReaderOf, streamPortsOf, type LedgerStreams } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

export function emittingInto(store: LedgerStreams): EmitEvent {
  const ledger = Ledger.of({ ...memoryLedger().service, ...streamPortsOf(store) });
  return eventEmitter(ledger, playbookOwnNamesOf([]));
}

export async function publishedEventIdsIn(store: LedgerStreams): Promise<readonly string[]> {
  const { records } = await Effect.runPromise(
    recordedReaderOf(store)({ org: 'acme', playbook: 'alpha' }, { kind: 'everything' }, { order: 'asc', limit: 100 }),
  );
  return records.flatMap((record) => {
    const published = publishedEventOf(record);
    return published === undefined ? [] : [published.data.event.id];
  });
}

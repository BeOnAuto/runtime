import type { RecordedKeys } from '@on.auto/ledger';
import { streamPrefixOfPlaybook, type Context, type PlaybookAddress } from '@on.auto/operations';
import { DatabaseFailed } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import type { ChainFact } from './chain-origin.ts';
import type { ChainReads } from './chain-origins.ts';

export interface StoredChainFact {
  readonly stream: string;
  readonly metadata: { readonly context: Context };
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

export interface ChainStore {
  readonly definitionsIn: (playbookKey: string) => Promise<readonly string[]>;
  readonly readRecordedOfKeys: (
    keys: RecordedKeys,
    selection: { readonly kind: 'run'; readonly run: string },
    page: { readonly order: 'asc'; readonly limit: number; readonly dataOf: readonly string[] },
  ) => Promise<{ readonly records: readonly StoredChainFact[] }>;
  readonly readRecordedEventOfKeys: (keys: RecordedKeys, id: string) => Promise<StoredChainFact | undefined>;
}

function chainFactOf(stored: StoredChainFact | undefined): ChainFact | undefined {
  return stored === undefined
    ? undefined
    : {
        stream: stored.stream,
        context: stored.metadata.context,
        causationId: stored.causationId,
        correlationId: stored.correlationId,
      };
}

function asked(
  reading: () => Promise<StoredChainFact | undefined>,
): Effect.Effect<ChainFact | undefined, DatabaseFailed> {
  return Effect.tryPromise({
    try: async () => chainFactOf(await reading()),
    catch: (failure) => new DatabaseFailed({ detail: String(failure) }),
  });
}

export function ledgerChainReads(store: ChainStore, playbook: PlaybookAddress): ChainReads<DatabaseFailed> {
  const playbookKey = streamPrefixOfPlaybook(playbook);
  const keysOfThePlaybook = async (): Promise<RecordedKeys> => ({
    org: playbook.org,
    keys: [playbookKey, ...(await store.definitionsIn(playbookKey))],
  });
  return {
    firstFactOf: (run) =>
      asked(async () => {
        const { records } = await store.readRecordedOfKeys(
          await keysOfThePlaybook(),
          { kind: 'run', run },
          { order: 'asc', limit: 1, dataOf: [] },
        );
        return records[0];
      }),
    recordOf: (id) => asked(async () => store.readRecordedEventOfKeys(await keysOfThePlaybook(), id)),
  };
}

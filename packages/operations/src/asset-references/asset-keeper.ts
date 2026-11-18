import { Context, type Effect } from 'effect';

import type { PlaybookContext } from '../caller/playbook-context.ts';
import type { RunContext } from '../ledger/context.ts';
import type { Lineage } from '../ledger/message-lineage.ts';
import type { PlaybookReader } from '../ledger/playbook-reader.ts';
import type { PlaybookWriter } from '../ledger/playbook-writer.ts';
import type { Conflict } from '../outcome/conflict.ts';
import type { AssetReference } from './asset-references.ts';

interface ValueToKeep {
  readonly pointer: string;
  readonly text: string;
  readonly mediaType: string;
}

interface RunOfAKeptValue {
  readonly context: Omit<RunContext, 'at'>;
  readonly lineage: Lineage;
}

export interface ValueKeeping {
  readonly kept: (
    run: RunOfAKeptValue,
    value: ValueToKeep,
  ) => Effect.Effect<AssetReference, Conflict, PlaybookWriter | PlaybookReader | PlaybookContext>;
}

export const AssetKeeper = Context.Reference<ValueKeeping | null>('@on.auto/operations/AssetKeeper', {
  defaultValue: () => null,
});

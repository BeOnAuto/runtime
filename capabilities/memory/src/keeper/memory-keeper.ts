import type {
  Conflict,
  Context,
  Ledger,
  Lineage,
  NotFound,
  ProjectedAddress,
  ProjectedKeyedRow,
  ProjectedRowsQuery,
  Unavailable,
} from '@on.auto/operations';
import type { Effect } from 'effect';

import type { AskedMemory, MemoryStatus } from '../facts/memory-decider.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import type { MemoryAt } from '../facts/memory-streams.ts';

export type MemoryLedger = Pick<
  Ledger['Service'],
  'load' | 'execute' | 'scrubFact' | 'readProjectedRows' | 'countProjectedRows'
>;

export interface Acting {
  readonly context: Context;
  readonly lineage?: Lineage;
}

export interface RememberAsk {
  readonly at: MemoryAt;
  readonly memory: AskedMemory;
  readonly replaces: boolean;
}

export type ForgottenStatus = 'forgotten' | 'erased';

export interface MarkedMoved {
  readonly as: MemoryAt;
  readonly memory?: AskedMemory;
}

export interface MemoryKeeper {
  readonly readyToRemember: (
    ask: RememberAsk,
    acting: Acting,
  ) => Effect.Effect<void, NotFound | Conflict | Unavailable>;
  readonly remembered: (ask: RememberAsk, acting: Acting) => Effect.Effect<number, NotFound | Conflict>;
  readonly rowsRead: (
    address: ProjectedAddress,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly standingOf: (at: MemoryAt) => Effect.Effect<MemoryStatus | undefined>;
  readonly forgotten: (at: MemoryAt, acting: Acting) => Effect.Effect<ForgottenStatus, NotFound | Conflict>;
  readonly erased: (at: MemoryAt, acting: Acting) => Effect.Effect<readonly MemoryAt[], NotFound | Conflict>;
  readonly moved: (from: MemoryAt, to: MemoryScope, acting: Acting) => Effect.Effect<MarkedMoved, NotFound | Conflict>;
}

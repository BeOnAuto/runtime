import { Context } from 'effect';

import type { LedgerStreams } from '../event-store.ts';
import type { Statement } from './statement.ts';

type Rows = readonly unknown[];

export type ReadRows = (statement: Statement) => Promise<Rows>;

export type Dialect = 'sqlite' | 'postgresql';

export interface LedgerReads {
  readonly read: ReadRows;
  readonly close: () => Promise<void>;
}

export interface ConnectionPorts {
  readonly dialect: Dialect;
  readonly streams: LedgerStreams;
  readonly read: ReadRows;
  readonly write: (statement: Statement) => Promise<Rows>;
  readonly transaction: (statements: readonly Statement[]) => Promise<Rows>;
  readonly readConsistently: <A>(reads: (read: ReadRows) => Promise<A>) => Promise<A>;
  readonly sharedClock: (() => Promise<number>) | null;
  readonly mostBoundValues: number;
  readonly migrated: (statements: readonly Statement[]) => Promise<void>;
}

export class LedgerConnection extends Context.Service<LedgerConnection, ConnectionPorts>()(
  '@on.auto/ledger/LedgerConnection',
) {}

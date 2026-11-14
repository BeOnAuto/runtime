import { chainOriginsOf, ledgerChainReads, type ChainFact, type ChainOrigin } from '@on.auto/goals';
import { LedgerConnection, statement } from '@on.auto/ledger';
import { streamPrefixOfPlaybook } from '@on.auto/operations';
import {
  endedRunsClosed,
  openWorkflowStore,
  rowsOf,
  WholeNumber,
  type ClosingPass,
  type HostDatabase,
} from '@on.auto/workflow-host';
import { Effect, ManagedRuntime, Schema } from 'effect';

import { ledgerLayerOf } from '../../composition/ledger-store.ts';
import type { LedgerDatabase } from '../../database/ledger-database.ts';
import type { TemporaryLedger } from '../records/temporary-ledger.ts';

export interface Opened {
  readonly environment: Readonly<Record<string, string>>;
  readonly ledger: TemporaryLedger;
  readonly database: () => LedgerDatabase;
}

const twoDays = 2 * 24 * 60 * 60 * 1000;

const CallRow = Schema.Struct({ calls: WholeNumber, kept: WholeNumber });

interface Read {
  readonly origins: ReadonlyMap<string, ChainOrigin>;
  readonly reads: number;
}

export interface OnTheLedger {
  readonly before: Read;
  readonly closed: ClosingPass;
  readonly calls: readonly (typeof CallRow.Type)[];
  readonly after: Read;
  readonly ended: Ended;
}

interface Ended {
  readonly origins: ReadonlyMap<string, string>;
  readonly reads: number;
}

const playbook = { org: 'acme', playbook: 'alpha' };

const callsKept = statement`SELECT COUNT(*) AS calls,
  COALESCE(SUM(CASE WHEN call IS NULL AND attributes IS NULL AND result IS NULL THEN 0 ELSE 1 END), 0) AS kept
  FROM workflow_calls`;

function endingsOf(database: HostDatabase, run: string) {
  return Effect.map(
    Effect.promise(() =>
      database.store.readRecorded(
        streamPrefixOfPlaybook(playbook),
        { kind: 'run', run },
        { order: 'desc', limit: 1, types: ['run_succeeded'], dataOf: [] },
      ),
    ),
    ({ records }) =>
      records.map((ending): ChainFact => ({
        stream: ending.stream,
        context: ending.metadata.context,
        causationId: ending.causationId,
        correlationId: ending.correlationId,
      })),
  );
}

function originsOfAPass(database: HostDatabase) {
  return chainOriginsOf(ledgerChainReads(database.store, playbook), { serviceCallers: new Set() });
}

const passOver = Effect.fnUntraced(function* (database: HostDatabase, runs: readonly string[]) {
  const origins = originsOfAPass(database);
  const found = yield* Effect.forEach(runs, (run) =>
    Effect.map(origins.originOf({ run }), (origin): readonly [string, ChainOrigin] => [run, origin]),
  );
  return { origins: new Map(found), reads: origins.reads() };
});

const passOverTheEndings = Effect.fnUntraced(function* (database: HostDatabase, runs: readonly string[]) {
  const origins = originsOfAPass(database);
  const found = yield* Effect.forEach(runs, (run) =>
    Effect.gen(function* () {
      const endings = yield* endingsOf(database, run);
      const named = yield* Effect.forEach(endings, (fact) => origins.originOf({ run, fact }));
      const one: readonly [string, string] = [run, named.join(' ')];
      return one;
    }),
  );
  return { origins: new Map(found), reads: origins.reads() };
});

export async function readOnTheLedger(opened: Opened, runs: readonly string[]): Promise<OnTheLedger> {
  const runtime = ManagedRuntime.make(ledgerLayerOf(opened.database()));
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const connection = yield* Effect.service(LedgerConnection);
        const { database } = yield* Effect.promise(() => openWorkflowStore(connection, []));
        const before = yield* passOver(database, runs);
        const closed = yield* endedRunsClosed(database, { now: Date.now() + twoDays, after: '', dryRun: false });
        const calls = yield* rowsOf(CallRow, database.read(callsKept));
        const after = yield* passOver(database, runs);
        const ended = yield* passOverTheEndings(database, runs);
        return { before, closed, calls, after, ended };
      }),
    );
  } finally {
    await runtime.dispose();
  }
}

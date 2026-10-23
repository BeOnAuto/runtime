import { Ledger, type ContentStore, type RunOutcomeMapping, type KeyedProjection } from '@on.auto/operations';
import { Context, Effect, Layer, Semaphore } from 'effect';

import { signalledOn, type AppendSignal } from './appends/append-signal.ts';
import { LedgerConnection, type ConnectionPorts } from './connection/ledger-connection.ts';
import { LedgerChores, orphansSweptOf } from './content/content-sweep.ts';
import type { AppendObserver, LedgerStore } from './event-store.ts';
import { makeLedger } from './ledger-service.ts';

export interface OpenedWith {
  readonly appends?: AppendSignal | undefined;
  readonly content?: ContentStore | undefined;
}

export interface StoreLayerOptions extends OpenedWith {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeyedProjection[] | undefined;
  readonly observer?: AppendObserver | undefined;
}

export interface OpenedLedger {
  readonly store: LedgerStore;
  readonly connection: ConnectionPorts;
}

export type LedgerServices = Ledger | LedgerConnection | LedgerChores;

export function ledgerLayerOver(
  open: () => OpenedLedger,
  { appends, content }: OpenedWith = {},
): Layer.Layer<LedgerServices> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const sweeping = yield* Semaphore.make(1);
      const opened = yield* Effect.acquireRelease(Effect.sync(open), ({ store }) =>
        sweeping.withPermit(Effect.promise(() => store.close())),
      );
      const store = signalledOn(opened.store, appends);
      yield* Effect.promise(() => store.migrate());
      const kept = content ?? store;
      const orphansSwept = orphansSweptOf(kept);
      const ledger = makeLedger({ ...store, content: kept.content, sweepContent: kept.sweepContent });
      return Context.make(Ledger, ledger).pipe(
        Context.add(LedgerConnection, opened.connection),
        Context.add(LedgerChores, { sweepOrphans: (now: number) => sweeping.withPermit(orphansSwept(now)) }),
      );
    }),
  );
}

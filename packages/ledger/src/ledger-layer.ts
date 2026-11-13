import { keptOutside, requireABatch, type ContentStore } from '@on.auto/content';
import { Ledger } from '@on.auto/operations';
import { Context, Effect, Layer, Semaphore } from 'effect';

import { signalledOn, type AppendSignal } from './appends/append-signal.ts';
import { LedgerConnection, type OpenedConnection } from './connection/ledger-connection.ts';
import { heldContentFoundBy, LedgerChores, orphansSweptOf, type ContentSweeping } from './content/content-sweep.ts';
import type { AppendListeners, LedgerContent, LedgerStore } from './event-store.ts';
import { makeLedger, ownContentOf } from './ledger-service.ts';
import { LedgerLog } from './log/ledger-log.ts';
import type { KeptTables } from './projections/projection-parts.ts';

export interface OpenedWith {
  readonly appends?: AppendSignal | undefined;
  readonly content?: ContentStore | undefined;
}

export interface StoreLayerOptions extends OpenedWith, AppendListeners, KeptTables {}

export interface OpenedLedger {
  readonly store: LedgerStore;
  readonly connection: OpenedConnection;
}

export type LedgerServices = Ledger | LedgerConnection | LedgerChores | LedgerLog;

function sweptWith(store: LedgerStore, content: ContentStore | undefined): ContentSweeping {
  return content === undefined
    ? store
    : {
        sweepContent: async (before) => {
          await store.sweepContent(before);
          await content.sweepContent(before);
        },
      };
}

function contentOf(store: LedgerStore, content: ContentStore | undefined): LedgerContent {
  return content === undefined ? ownContentOf(store) : keptOutside(store.externalHeadsWith(store.unlessHeld), content);
}

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
      const orphansSwept = orphansSweptOf(sweptWith(store, content));
      const kept = contentOf(store, content);
      const ledger = makeLedger(store, kept);
      return Context.make(Ledger, ledger).pipe(
        Context.add(LedgerConnection, { ...opened.connection, content: ledger.content }),
        Context.add(LedgerLog, store.log),
        Context.add(LedgerChores, {
          sweepOrphans: (now: number) => sweeping.withPermit(orphansSwept(now)),
          eraseExpired: (most: number) =>
            Effect.andThen(requireABatch(most), sweeping.withPermit(kept.eraseExpired(most))),
          heldContentFound: heldContentFoundBy({ heldHeads: store.heldHeads, kept, outside: content !== undefined }),
          endWaits: Effect.sync(() => {
            store.endWaits();
          }),
        }),
      );
    }),
  );
}

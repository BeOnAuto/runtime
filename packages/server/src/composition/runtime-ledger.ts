import type { AppRuntime } from '@on.auto/api';
import type { RecordedContent } from '@on.auto/content';
import type { ConversationLedger } from '@on.auto/interaction';
import { Ledger, type DispatcherServices, type ProjectionReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

interface RuntimeLedger
  extends ConversationLedger, Pick<ProjectionReader, 'countProjectedRows'>, Pick<Ledger['Service'], 'removeUnheld'> {
  readonly content: Pick<RecordedContent, 'put' | 'get' | 'getHead' | 'getPart'>;
}

export function runtimeLedger(runtime: AppRuntime<DispatcherServices>): RuntimeLedger {
  const viaLedger = <A, E>(use: (ledger: Ledger['Service']) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    inRuntime(runtime, Effect.flatMap(Effect.service(Ledger), use));
  return {
    load: (stream, decider) => viaLedger((ledger) => ledger.load(stream, decider)),
    factAt: (stream, position, eventSchema) => viaLedger((ledger) => ledger.factAt(stream, position, eventSchema)),
    execute: (stream, decider, command, lineage) =>
      viaLedger((ledger) => ledger.execute(stream, decider, command, lineage)),
    removeUnheld: (playbook, sha256) => viaLedger((ledger) => ledger.removeUnheld(playbook, sha256)),
    readRecorded: (playbook, selection, page) => viaLedger((ledger) => ledger.readRecorded(playbook, selection, page)),
    readProjectedRows: (projection, playbook, query) =>
      viaLedger((ledger) => ledger.readProjectedRows(projection, playbook, query)),
    advanceRow: (projection, playbook, key, advance) =>
      viaLedger((ledger) => ledger.advanceRow(projection, playbook, key, advance)),
    countProjectedRows: (projection, playbook, where) =>
      viaLedger((ledger) => ledger.countProjectedRows(projection, playbook, where)),
    readDueRows: (projection, query) => viaLedger((ledger) => ledger.readDueRows(projection, query)),
    nextDueOf: (projection, column, after) => viaLedger((ledger) => ledger.nextDueOf(projection, column, after)),
    content: {
      put: (playbook, content) => viaLedger((ledger) => ledger.content.put(playbook, content)),
      get: (playbook, sha256) => viaLedger((ledger) => ledger.content.get(playbook, sha256)),
      getHead: (playbook, sha256) => viaLedger((ledger) => ledger.content.getHead(playbook, sha256)),
      getPart: (playbook, sha256, asked) => viaLedger((ledger) => ledger.content.getPart(playbook, sha256, asked)),
    },
  };
}

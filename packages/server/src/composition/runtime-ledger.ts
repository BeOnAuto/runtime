import type { AppRuntime } from '@on.auto/api';
import type { ConversationLedger } from '@on.auto/interaction';
import { Ledger, type DispatcherServices, type ProjectionReader } from '@on.auto/operations';
import type { PredictionLedger } from '@on.auto/prediction';
import { Effect } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

type RuntimeLedger = ConversationLedger & Pick<ProjectionReader, 'countProjectedRows'> & PredictionLedger;

export function runtimeLedger(runtime: AppRuntime<DispatcherServices>): RuntimeLedger {
  const viaLedger = <A, E>(use: (ledger: Ledger['Service']) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    inRuntime(runtime, Effect.flatMap(Effect.service(Ledger), use));
  return {
    load: (stream, decider) => viaLedger((ledger) => ledger.load(stream, decider)),
    execute: (stream, decider, command, lineage) =>
      viaLedger((ledger) => ledger.execute(stream, decider, command, lineage)),
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
      stage: (playbook, run, content) => viaLedger((ledger) => ledger.content.stage(playbook, run, content)),
      staged: (playbook, run, sha256) => viaLedger((ledger) => ledger.content.staged(playbook, run, sha256)),
      unstage: (playbook, run) => viaLedger((ledger) => ledger.content.unstage(playbook, run)),
    },
  };
}

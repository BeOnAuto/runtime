import { statement } from '@on.auto/ledger';
import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { listenFiltersOf, loadedRunOf, valueAtPointer, type CallKey } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { reactionOfRun } from '../reactions/run-attributes.ts';
import { ledgerRunLogStore } from '../runs/ledger-run-store.ts';
import { addressOfRun, runLogStreamOf } from '../runs/run-address.ts';

const RunRow = Schema.Struct({ run_key: Schema.String });

const scanOfListeners = 'listeners';

function listenersOfRun(database: HostDatabase, runKey: string) {
  return Effect.gen(function* () {
    const { state, version } = loadedRunOf(yield* ledgerRunLogStore(database).load(runKey));
    const document = state.workflow?.document ?? {};
    const listeners = Object.entries(state.listeners);
    if (listeners.length === 0) {
      return;
    }
    const reaction = reactionOfRun(state.attributes);
    yield* Effect.forEach(
      listeners,
      ([listener, key]: readonly [string, CallKey]) =>
        insertedListener(database, {
          runKey,
          listener,
          playbookKey: streamPrefixOfPlaybook(addressOfRun(runKey)),
          streamId: runLogStreamOf(runKey),
          armedBy: version,
          filters: JSON.stringify(listenFiltersOf(valueAtPointer(document, key.reference))),
          workflow: reaction.workflow,
          version: reaction.version,
          passed: true,
        }),
      { discard: true },
    );
  });
}

export function scannedListeners(database: HostDatabase): Effect.Effect<number> {
  return Effect.orDie(
    Effect.gen(function* () {
      const done = yield* database.read(
        statement`SELECT name FROM workflow_followed_scans WHERE name = ${scanOfListeners}`,
      );
      if (done.length > 0) {
        return 0;
      }
      const live = yield* rowsOf(
        RunRow,
        database.read(statement`SELECT run_key FROM workflow_runs WHERE ended_at IS NULL`),
      );
      yield* Effect.forEach(live, ({ run_key: runKey }) => listenersOfRun(database, runKey), { discard: true });
      yield* database.write(statement`INSERT INTO workflow_followed_scans (name) VALUES (${scanOfListeners})`);
      return live.length;
    }),
  );
}

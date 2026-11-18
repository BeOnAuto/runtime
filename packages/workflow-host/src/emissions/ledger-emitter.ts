import type { EmitEvent } from '@on.auto/definitions';
import { messageIdOf } from '@on.auto/operations';
import { DispatchFailed, type Emitter } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { reactionOfRun } from '../reactions/run-attributes.ts';
import { addressOfRun, runLogStreamOf } from '../runs/run-address.ts';
import { playbookOfRun } from '../runs/run-places.ts';

export function ledgerEmitter(emit: EmitEvent, database: Pick<HostDatabase, 'read'>, now: () => number): Emitter {
  return {
    emit: (emission, run, origin) => {
      const address = addressOfRun(run.runId);
      const { workflow, version, caller, depth, correlation } = reactionOfRun(run.attributes);
      const lineage = {
        causationId: messageIdOf(runLogStreamOf(run.runId), origin.version),
        correlationId: correlation ?? address.runId,
      };
      return Effect.flatMap(playbookOfRun(database, run.runId), (playbook) =>
        emit(
          playbook,
          {
            event: emission.event,
            emitter: { run_id: address.runId, workflow, version },
            depth: depth + 1,
            by: caller,
            at: new Date(now()).toISOString(),
          },
          lineage,
        ),
      ).pipe(
        Effect.mapError(
          ({ detail }: Readonly<{ detail: string }>) => new DispatchFailed({ output: 'emit_event', detail }),
        ),
      );
    },
  };
}

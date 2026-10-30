import type { RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { passedListeners, pendingArmings, runPassedThrough } from '../listeners/listener-rows.ts';

export type GateVerdict = 'held' | 'passed' | 'listened' | 'overdue';

export interface RunGate {
  readonly verdictOn: (record: RecordedEvent, overdue: boolean) => Effect.Effect<GateVerdict>;
}

interface Known {
  readonly through: number;
  readonly pending: readonly number[];
}

export function runGateOf(database: HostDatabase, playbookKey: string): RunGate {
  const watermark = sqlWatermark(database);
  const [, org = '', playbook = ''] = playbookKey.split('/');
  const known = new Map<string, Known>();
  const knownOf = (runKey: string, record: RecordedEvent): Effect.Effect<Known> => {
    const cached = known.get(runKey);
    return cached !== undefined && cached.through >= record.version
      ? Effect.succeed(cached)
      : Effect.map(
          Effect.zip(watermark.read(runKey), pendingArmings(database, record.stream)),
          ([through, pending]: readonly [number, readonly number[]]) => {
            known.set(runKey, { through, pending });
            return { through, pending };
          },
        );
  };
  return {
    verdictOn: (record, overdue) =>
      Effect.gen(function* () {
        const runKey = `${org}/${playbook}/${record.stream.slice(record.stream.lastIndexOf('/') + 1)}`;
        const { through, pending } = yield* knownOf(runKey, record);
        const behind = through < record.version;
        if (behind && !overdue) {
          return 'held';
        }
        const armed = pending.some((armedBy) => armedBy <= record.version);
        if (behind) {
          yield* runPassedThrough(database, runKey, record.version);
        }
        if (behind || armed) {
          known.set(runKey, { through, pending: pending.filter((armedBy) => armedBy > record.version) });
          yield* passedListeners(database, record.stream, record.version);
        }
        if (behind) {
          return 'overdue';
        }
        return armed ? 'listened' : 'passed';
      }),
  };
}

import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { playbookCreated, testDefinitionsPlaced } from '../reaction-testing/playbook-writes.ts';
import type { HeldWork } from '../testing/clock-sleepers.ts';
import { aLedgerInMemory, openedOn, type LedgerOn } from '../testing/host-files.ts';
import { hostedOn, hostedStartsAt, type SteppedHostedOptions } from '../testing/host-runs.ts';
import { steppedClock } from '../testing/stepped-clock.ts';
import { settledIn, type FollowedHost } from './followed-host.ts';

export interface HeldFollower extends FollowedHost {
  readonly release: () => void;
}

function placingHeldUntil(work: HeldWork, database: HostDatabase): HostDatabase {
  return {
    ...database,
    store: {
      ...database.store,
      definitionStreams: async (definitionType) => {
        await Effect.runPromise(work.wait);
        return database.store.definitionStreams(definitionType);
      },
    },
  };
}

export async function heldFollower(
  options: Omit<SteppedHostedOptions, 'clock'> = {},
  given?: LedgerOn,
): Promise<HeldFollower> {
  const settings = given ?? (await aLedgerInMemory());
  const database = await openedOn(settings);
  await playbookCreated(database.store, 'alpha');
  await testDefinitionsPlaced(database.store);
  const clock = steppedClock(hostedStartsAt);
  const work = clock.hold();
  const held = placingHeldUntil(work, await openedOn(settings));
  const hosted = await hostedOn({ database: held }, { ...options, clock });
  return {
    database,
    hosted,
    settled: settledIn(hosted),
    release: work.release,
  };
}

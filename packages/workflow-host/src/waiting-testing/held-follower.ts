import type { HostDatabase } from '../database/host-database.ts';
import { playbookCreated, testDefinitionsPlaced } from '../reaction-testing/playbook-writes.ts';
import { aSQLiteFile, openedOn, type DatabaseSettings } from '../testing/host-files.ts';
import { hostedOn, type HostedOptions } from '../testing/host-runs.ts';
import { settledIn, type FollowedHost } from './followed-host.ts';

export interface HeldFollower extends FollowedHost {
  readonly release: () => void;
}

function placingHeldUntil(released: Promise<void>, database: HostDatabase): HostDatabase {
  return {
    ...database,
    store: {
      ...database.store,
      definitionStreams: async (definitionType) => {
        await released;
        return database.store.definitionStreams(definitionType);
      },
    },
  };
}

function aSQLiteLedger(): DatabaseSettings {
  return { store: 'sqlite', file: aSQLiteFile() };
}

export async function heldFollower(
  options: HostedOptions = {},
  settings: DatabaseSettings = aSQLiteLedger(),
): Promise<HeldFollower> {
  const database = await openedOn(settings);
  await playbookCreated(database.store, 'alpha');
  await testDefinitionsPlaced(database.store);
  const released = Promise.withResolvers<void>();
  const held = placingHeldUntil(released.promise, await openedOn(settings));
  const hosted = await hostedOn({ database: held }, options);
  return {
    database,
    hosted,
    settled: settledIn(hosted),
    release: () => {
      released.resolve();
    },
  };
}

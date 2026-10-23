import { playbooksStreamOfOrg } from '@on.auto/playbooks';

import type { HostDatabase } from '../database/host-database.ts';
import { playbookCreated } from '../reaction-testing/playbook-writes.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn, type HostedOptions } from '../testing/host-runs.ts';
import { settledIn, type FollowedHost } from './followed-host.ts';

export interface HeldFollower extends FollowedHost {
  readonly release: () => void;
}

function registryHeldUntil(released: Promise<void>, database: HostDatabase): HostDatabase {
  const registry = playbooksStreamOfOrg('acme');
  return {
    ...database,
    store: {
      ...database.store,
      read: async (stream, after) => {
        if (stream === registry) {
          await released;
        }
        return database.store.read(stream, after);
      },
    },
  };
}

export async function heldFollower(options: HostedOptions = {}): Promise<HeldFollower> {
  const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
  const database = await openedOn(settings);
  await playbookCreated(database.store, 'alpha');
  const released = Promise.withResolvers<void>();
  const held = registryHeldUntil(released.promise, await openedOn(settings));
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

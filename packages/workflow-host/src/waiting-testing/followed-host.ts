import { recordedReaderOf, statement } from '@on.auto/ledger';
import type { Settlement } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { alpha, playbookCreated } from '../reaction-testing/playbook-writes.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn, type HostedOptions, type HostedRuns } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

export interface FollowedHost {
  readonly database: HostDatabase;
  readonly hosted: HostedRuns;
  readonly settled: (runId: string) => Promise<Settlement | undefined>;
}

export function settledIn(hosted: HostedRuns): (runId: string) => Promise<Settlement | undefined> {
  return (runId) =>
    until(
      () => Promise.resolve(hosted.settlements().get(runId)),
      (settlement) => settlement !== undefined,
    );
}

export async function untilFollowed(database: HostDatabase): Promise<void> {
  await until(
    () => Effect.runPromise(database.read(statement`SELECT playbook_key FROM workflow_followed_playbooks`)),
    (rows) => rows.length > 0,
  );
}

export async function followedHost(options: HostedOptions = {}): Promise<FollowedHost> {
  const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
  const database = await openedOn(settings);
  await playbookCreated(database.store, 'alpha');
  const hosted = await hostedOn(settings, options);
  await untilFollowed(database);
  return {
    database,
    hosted,
    settled: settledIn(hosted),
  };
}

const Places = Schema.Array(Schema.Struct({ cursor: Schema.NullOr(Schema.String) }));

export async function followedThroughTheLatest(database: HostDatabase): Promise<void> {
  const { records } = await Effect.runPromise(
    recordedReaderOf(database.store)(
      { org: 'acme', playbook: 'alpha' },
      { kind: 'everything' },
      { order: 'desc', limit: 1 },
    ),
  );
  await until(
    async () =>
      Schema.decodeUnknownSync(Places)(
        await Effect.runPromise(
          database.read(statement`SELECT cursor FROM workflow_followed_playbooks WHERE playbook_key = ${alpha}`),
        ),
      ),
    (places) => places[0]?.cursor === records[0]?.cursor,
  );
}

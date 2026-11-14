import { statement } from '@on.auto/ledger';
import type { RecordedEvent, RecordedPage, Settlement } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { oneRowOf, type HostDatabase } from '../database/host-database.ts';
import { noRecordTypes, playbookRecordsOf } from '../follower/playbook-records.ts';
import { alpha, playbookCreated } from '../reaction-testing/playbook-writes.ts';
import { followedPlaybookOf } from '../sweeps/wakes.ts';
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

const Place = Schema.Struct({ cursor: Schema.NullOr(Schema.String) });

function recordsAfterThePlaceOf(database: HostDatabase): Promise<RecordedPage> {
  const place = oneRowOf(
    Place,
    database.read(statement`SELECT cursor FROM workflow_followed_playbooks WHERE playbook_key = ${alpha}`),
  );
  return Effect.runPromise(
    Effect.flatMap(place, ({ cursor }) =>
      playbookRecordsOf(database.store).after({ org: 'acme', playbook: 'alpha' }, cursor, noRecordTypes),
    ),
  );
}

function wakesTheFollower({ stream }: RecordedEvent): boolean {
  return followedPlaybookOf(stream) !== undefined;
}

export async function followedThroughTheLatest(database: HostDatabase): Promise<void> {
  await until(
    () => recordsAfterThePlaceOf(database),
    ({ records, hasMore }) => !hasMore && !records.some((record) => wakesTheFollower(record)),
  );
}

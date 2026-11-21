import { statement } from '@on.auto/ledger';
import type { RecordedEvent, RecordedPage, Settlement } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { orgRecordsOf, wokenOrgOf } from '../follower/org-records.ts';
import { noRecordTypes } from '../follower/playbook-records.ts';
import { playbookCreated, testDefinitionsPlaced } from '../reaction-testing/playbook-writes.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn, type HostedOptions, type HostedRuns } from '../testing/host-runs.ts';

/** A host a test can wait on: what it keeps is read again each time it records or rests. */
export type Resting = Pick<HostedRuns, 'whenRead'>;

export interface FollowedHost {
  readonly database: HostDatabase;
  readonly hosted: HostedRuns;
  readonly settled: (runId: string) => Promise<Settlement | undefined>;
}

export function settledIn(hosted: HostedRuns): (runId: string) => Promise<Settlement | undefined> {
  return (runId) =>
    hosted.when(
      () => hosted.settlements().get(runId),
      (settlement) => settlement !== undefined,
    );
}

export async function untilFollowed(database: HostDatabase, host: Resting): Promise<void> {
  await host.whenRead(
    () => Effect.runPromise(database.read(statement`SELECT org FROM workflow_followed_orgs`)),
    (rows) => rows.length > 0,
  );
}

export async function followedHost(options: HostedOptions = {}): Promise<FollowedHost> {
  const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
  const database = await openedOn(settings);
  await playbookCreated(database.store, 'alpha');
  await testDefinitionsPlaced(database.store);
  const hosted = await hostedOn(settings, options);
  await untilFollowed(database, hosted);
  return {
    database,
    hosted,
    settled: settledIn(hosted),
  };
}

const Place = Schema.Struct({ cursor: Schema.NullOr(Schema.String) });

/** The records after the place the follower keeps for the org, or null while it has kept no place yet. */
function recordsAfterThePlaceOf(database: HostDatabase): Promise<RecordedPage | null> {
  const places = rowsOf(Place, database.read(statement`SELECT cursor FROM workflow_followed_orgs WHERE org = 'acme'`));
  return Effect.runPromise(
    Effect.flatMap(places, ([place]) =>
      place === undefined
        ? Effect.succeed(null)
        : orgRecordsOf(database.store).after('acme', place.cursor, noRecordTypes),
    ),
  );
}

function wakesTheFollower({ stream }: RecordedEvent): boolean {
  return wokenOrgOf(stream) !== undefined;
}

export async function followedThroughTheLatest(database: HostDatabase, host: Resting): Promise<void> {
  await host.whenRead(
    () => recordsAfterThePlaceOf(database),
    (page) => page !== null && !page.hasMore && !page.records.some((record) => wakesTheFollower(record)),
  );
}

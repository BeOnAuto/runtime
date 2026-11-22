import { statement } from '@on.auto/ledger';
import type { RecordedPage, Settlement } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { oneRowOf, type HostDatabase } from '../database/host-database.ts';
import { orgRecordsOf } from '../follower/org-records.ts';
import { noRecordTypes } from '../follower/playbook-records.ts';
import { playbookCreated, testDefinitionsPlaced } from '../reaction-testing/playbook-writes.ts';
import { aLedgerInMemory, openedOn } from '../testing/host-files.ts';
import { hostedOn, type SteppedHostedOptions, type HostedRuns } from '../testing/host-runs.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';

/** A host a test can wait on: what it keeps is read each time it rests, a sweep stepped between. */
export type Resting = Pick<HostedRuns, 'sweeps'>;

export interface FollowedHost {
  readonly database: HostDatabase;
  readonly hosted: HostedRuns;
  readonly settled: (runId: string) => Promise<Settlement | undefined>;
}

export function settledIn(hosted: HostedRuns): (runId: string) => Promise<Settlement | undefined> {
  return (runId) =>
    hosted.sweeps.until(
      () => hosted.settlements().get(runId),
      (settlement) => settlement !== undefined,
      fewSweeps,
    );
}

export async function untilFollowed(database: HostDatabase, host: Resting): Promise<void> {
  await host.sweeps.until(
    () => Effect.runPromise(database.read(statement`SELECT org FROM workflow_followed_orgs`)),
    (rows) => rows.length > 0,
    fewSweeps,
  );
}

export async function followedHost(options: SteppedHostedOptions = {}): Promise<FollowedHost> {
  const settings = await aLedgerInMemory();
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

/** The records after the place the follower keeps for the org, which a host at rest has kept. */
function recordsAfterThePlaceOf(database: HostDatabase): Promise<RecordedPage> {
  const place = oneRowOf(Place, database.read(statement`SELECT cursor FROM workflow_followed_orgs WHERE org = 'acme'`));
  return Effect.runPromise(
    Effect.flatMap(place, ({ cursor }) => orgRecordsOf(database.store).after('acme', cursor, noRecordTypes)),
  );
}

export async function followedThroughTheLatest(database: HostDatabase, host: Resting): Promise<void> {
  await host.sweeps.until(
    () => recordsAfterThePlaceOf(database),
    (page) => !page.hasMore && page.records.length === 0,
    fewSweeps,
  );
}

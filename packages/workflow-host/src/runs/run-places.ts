import { statement } from '@on.auto/ledger';
import {
  definitionOfStreamPrefix,
  playbookOfStreamPrefix,
  runStreamNameOf,
  streamPrefixOfOrg,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { addressOfRun, definitionKeyOfRun, runKeyOf, type RunAddress } from './run-address.ts';

const PlaybookRow = Schema.Struct({ playbook_key: Schema.NullOr(Schema.String) });

function placeOf(database: Pick<HostDatabase, 'read'>, runKey: string): Effect.Effect<PlaybookAddress | undefined> {
  return Effect.map(
    Effect.orDie(
      rowsOf(PlaybookRow, database.read(statement`SELECT playbook_key FROM workflow_runs WHERE run_key = ${runKey}`)),
    ),
    ([row]) => Option.getOrUndefined(Option.flatMap(Option.fromNullishOr(row?.playbook_key), playbookOfStreamPrefix)),
  );
}

export function knownRunOf(
  database: Pick<HostDatabase, 'read'>,
  runKey: string,
): Effect.Effect<RunAddress | undefined> {
  return Effect.map(placeOf(database, runKey), (place) =>
    place === undefined ? undefined : { ...addressOfRun(runKey), playbook: place.playbook },
  );
}

export function playbookOfRun(database: Pick<HostDatabase, 'read'>, runKey: string): Effect.Effect<PlaybookAddress> {
  return Effect.flatMap(placeOf(database, runKey), (place) =>
    place === undefined
      ? Effect.die(new Error(`The run ${runKey} was started in no playbook this host knows`))
      : Effect.succeed(place),
  );
}

function holderOf(
  database: Pick<HostDatabase, 'store'>,
  org: string,
  runId: string,
): Effect.Effect<string | undefined> {
  return Effect.promise(() =>
    database.store.holderOfRunId({ orgKey: streamPrefixOfOrg({ org }), runId: runId.toLowerCase() }),
  );
}

export function runKeyOfAnId(
  database: Pick<HostDatabase, 'store'>,
  org: string,
  runId: string,
): Effect.Effect<string | undefined> {
  return Effect.map(holderOf(database, org, runId), (definitionKey) =>
    definitionKey === undefined
      ? undefined
      : Option.getOrUndefined(
          Option.map(definitionOfStreamPrefix(definitionKey), ({ definition }) => runKeyOf({ org, definition, runId })),
        ),
  );
}

function runStreamOfAnId(
  database: Pick<HostDatabase, 'store'>,
  org: string,
  runId: string,
): Effect.Effect<string | undefined> {
  return Effect.map(holderOf(database, org, runId), (definitionKey) =>
    definitionKey === undefined ? undefined : `${definitionKey}${runStreamNameOf(runId)}`,
  );
}

export function runStreamOfAChild(
  database: Pick<HostDatabase, 'store'>,
  runKey: string,
  child: string,
): Effect.Effect<string | undefined> {
  return runStreamOfAnId(database, addressOfRun(runKey).org, child);
}

export function runStreamOfTheKey(runKey: string): string {
  return `${definitionKeyOfRun(runKey)}${runStreamNameOf(addressOfRun(runKey).runId)}`;
}

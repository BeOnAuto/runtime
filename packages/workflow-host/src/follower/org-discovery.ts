import { playbookKeyOfStream, type RecordedPoint } from '@on.auto/ledger';
import { definitionOfStreamPrefix } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { orgFollowerCursorOf } from '../database/org-follower-tables.ts';
import { isAfter } from '../pages/history-points.ts';
import {
  definitionRecordsIn,
  type ApplyDefinitionRecord,
  type DefinitionRecord,
} from '../triggers/definition-records.ts';
import type { DefinitionPlace } from '../triggers/trigger-rows.ts';
import type { FollowedOrgs } from './followed-orgs.ts';
import { scannedListeners } from './listener-scan.ts';

export interface Discovery {
  readonly atStart: () => Effect.Effect<void>;
  readonly orgSeen: (org: string) => Effect.Effect<void>;
}

export interface DiscoveryParts {
  readonly database: HostDatabase;
  readonly orgs: Pick<FollowedOrgs, 'follow' | 'load'>;
  readonly placeAtOpen: RecordedPoint;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (playbookKey: string, record: DefinitionRecord) => Effect.Effect<void>;
  readonly definitionType: string;
}

interface Workflow extends DefinitionPlace {
  readonly org: string;
}

function recordedBefore(
  { database, placeAtOpen, unreadable }: Pick<DiscoveryParts, 'database' | 'placeAtOpen' | 'unreadable'>,
  { playbookKey, definitionKey }: DefinitionPlace,
  records: readonly DefinitionRecord[],
): Effect.Effect<readonly DefinitionRecord[]> {
  const keptOf = (count: number): Effect.Effect<number> => {
    const newest = records[count - 1];
    if (newest === undefined) {
      return Effect.succeed(0);
    }
    return Effect.flatMap(
      Effect.promise(() => database.store.readRecordedEvent(definitionKey, newest.id)),
      (stored): Effect.Effect<number> => {
        if (stored === undefined) {
          return Effect.andThen(unreadable(playbookKey, newest), keptOf(count - 1));
        }
        return isAfter(stored.point, placeAtOpen) ? keptOf(count - 1) : Effect.succeed(count);
      },
    );
  };
  return Effect.map(keptOf(records.length), (kept) => records.slice(0, kept));
}

function workflowsOf(parts: DiscoveryParts): Effect.Effect<readonly Workflow[]> {
  return Effect.map(
    Effect.promise(() => parts.database.store.definitionStreams(parts.definitionType)),
    (streams) =>
      streams.flatMap(({ stream, playbookKey }) => {
        const definitionKey = playbookKeyOfStream(stream) ?? '';
        return Option.match(definitionOfStreamPrefix(definitionKey), {
          onNone: () => [],
          onSome: ({ org }) => [{ org, playbookKey, definitionKey }],
        });
      }),
  );
}

function followedFromTheOpenOn(parts: DiscoveryParts) {
  const { database, orgs, placeAtOpen, applyDefinitionRecord, unreadable, definitionType } = parts;
  const applied = (place: DefinitionPlace, record: DefinitionRecord) =>
    Effect.flatMap(applyDefinitionRecord(place, record), (outcome) =>
      outcome === 'unreadable' ? unreadable(place.playbookKey, record) : Effect.void,
    );
  const workflowFollowed = (place: DefinitionPlace) =>
    Effect.gen(function* () {
      const recorded = yield* Effect.promise(() =>
        database.store.read(`${place.definitionKey}definitions/${definitionType}`, 0),
      );
      const beforeTheOpen = yield* recordedBefore(parts, place, definitionRecordsIn(recorded));
      yield* Effect.forEach(beforeTheOpen, (record) => applied(place, record), { discard: true });
    });
  return (org: string, workflows: readonly Workflow[]) =>
    Effect.gen(function* () {
      if ((yield* orgs.load(org)) !== undefined) {
        return;
      }
      yield* orgs.follow(org, orgFollowerCursorOf(org, placeAtOpen));
      yield* Effect.forEach(
        workflows.filter((workflow) => workflow.org === org),
        (workflow) => workflowFollowed(workflow),
        { discard: true },
      );
    });
}

export function orgDiscoveryOn(parts: DiscoveryParts): Discovery {
  const followedFromTheOpen = followedFromTheOpenOn(parts);
  const everyOrg = Effect.gen(function* () {
    const workflows = yield* workflowsOf(parts);
    yield* Effect.forEach([...new Set(workflows.map(({ org }) => org))], (org) => followedFromTheOpen(org, workflows), {
      discard: true,
    });
  });
  return {
    atStart: () => Effect.andThen(everyOrg, scannedListeners(parts.database)),
    orgSeen: (org) => parts.orgs.follow(org, orgFollowerCursorOf(org, parts.placeAtOpen)),
  };
}

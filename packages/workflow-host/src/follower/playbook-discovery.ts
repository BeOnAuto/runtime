import { recordedCursorOf, type RecordedPoint, statement } from '@on.auto/ledger';
import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';
import { playbookCreatedOf, playbooksStreamOfOrg } from '@on.auto/playbooks';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import {
  definitionRecordsIn,
  type ApplyDefinitionRecord,
  type DefinitionRecord,
} from '../triggers/definition-records.ts';
import type { FollowedPlaybooks } from './followed-playbooks.ts';
import { scannedListeners } from './listener-scan.ts';

export interface Discovery {
  readonly atStart: () => Effect.Effect<void>;
  readonly registriesAppended: (registries: readonly string[]) => Effect.Effect<void>;
  readonly playbookSeen: (playbookKey: string) => Effect.Effect<void>;
}

export interface DiscoveryParts {
  readonly database: HostDatabase;
  readonly playbooks: FollowedPlaybooks;
  readonly placeAtOpen: RecordedPoint;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (playbookKey: string, record: DefinitionRecord) => Effect.Effect<void>;
  readonly definitionType: string;
}

const OrgStreamRow = Schema.Struct({ stream_id: Schema.String, stream_position: WholeNumber });

const SeenRow = Schema.Struct({ stream_id: Schema.String, position: WholeNumber });

const PositionRow = Schema.Struct({ position: WholeNumber });

const orgRegistry = new RegExp(`^${playbooksStreamOfOrg('([^/]+)')}$`, 'u');

const theRegistryOfEveryOrg = playbooksStreamOfOrg('%');

export function isOrgRegistry(stream: string): boolean {
  return orgRegistry.test(stream);
}

interface Registry {
  readonly stream: string;
  readonly org: string;
}

function registriesOf(streams: readonly string[]): readonly Registry[] {
  return streams.flatMap((stream) => {
    const [, org] = orgRegistry.exec(stream) ?? [];
    return org === undefined ? [] : [{ stream, org }];
  });
}

function orgsOf(database: HostDatabase) {
  return Effect.orDie(
    Effect.zip(
      rowsOf(
        OrgStreamRow,
        database.read(
          statement`SELECT stream_id, stream_position FROM emt_streams
            WHERE stream_id LIKE ${theRegistryOfEveryOrg} AND is_archived = FALSE`,
        ),
      ),
      rowsOf(SeenRow, database.read(statement`SELECT stream_id, position FROM workflow_followed_orgs`)),
    ),
  );
}

function seenOf(database: HostDatabase, stream: string): Effect.Effect<number | undefined> {
  return Effect.orDie(
    rowsOf(
      PositionRow,
      database.read(statement`SELECT position FROM workflow_followed_orgs WHERE stream_id = ${stream}`),
    ),
  ).pipe(Effect.map((rows) => rows.at(0)?.position));
}

function followedFromTheOpenOn({
  database,
  playbooks,
  placeAtOpen,
  applyDefinitionRecord,
  unreadable,
  definitionType,
}: DiscoveryParts) {
  const applied = (playbookKey: string, record: DefinitionRecord) =>
    Effect.flatMap(applyDefinitionRecord(playbookKey, record), (outcome) =>
      outcome === 'unreadable' ? unreadable(playbookKey, record) : Effect.void,
    );
  return (playbook: PlaybookAddress) =>
    Effect.gen(function* () {
      const playbookKey = streamPrefixOfPlaybook(playbook);
      yield* playbooks.follow(playbookKey, recordedCursorOf(playbookKey, placeAtOpen));
      const recorded = yield* Effect.promise(() =>
        database.store.read(`${playbookKey}definitions/${definitionType}`, 0),
      );
      yield* Effect.forEach(definitionRecordsIn(recorded), (record) => applied(playbookKey, record), { discard: true });
    });
}

function registryReadOn(
  { database, playbooks }: DiscoveryParts,
  followedFromTheOpen: ReturnType<typeof followedFromTheOpenOn>,
) {
  return ({ stream, org }: Registry, after: number | undefined, atStart: boolean) =>
    Effect.gen(function* () {
      const { messages, version } = yield* Effect.promise(() => database.store.read(stream, after ?? 0));
      if (version === after) {
        return;
      }
      const created: readonly PlaybookAddress[] = messages.flatMap((message) => {
        const playbook = playbookCreatedOf(message);
        return playbook === undefined ? [] : [{ org, playbook }];
      });
      yield* Effect.forEach(
        created,
        (playbook) =>
          atStart && after === undefined
            ? followedFromTheOpen(playbook)
            : playbooks.follow(streamPrefixOfPlaybook(playbook), null),
        { discard: true },
      );
      yield* Effect.orDie(
        database.write(
          statement`INSERT INTO workflow_followed_orgs (stream_id, position) VALUES (${stream}, ${version})
            ON CONFLICT (stream_id) DO UPDATE SET position = excluded.position`,
        ),
      );
    });
}

export function playbookDiscoveryOn(parts: DiscoveryParts): Discovery {
  const { database, playbooks } = parts;
  const registryRead = registryReadOn(parts, followedFromTheOpenOn(parts));
  const everyRegistry = Effect.gen(function* () {
    const [streams, seen] = yield* orgsOf(database);
    const seenAt = new Map(seen.map(({ stream_id: stream, position }) => [stream, position]));
    const changed = streams.filter(
      ({ stream_id: stream, stream_position: position }) => seenAt.get(stream) !== position,
    );
    yield* Effect.forEach(
      registriesOf(changed.map(({ stream_id: stream }) => stream)),
      (registry) => registryRead(registry, seenAt.get(registry.stream), true),
      { discard: true },
    );
  });
  return {
    atStart: () => Effect.andThen(everyRegistry, scannedListeners(database)),
    registriesAppended: (registries) =>
      Effect.forEach(
        registriesOf(registries),
        (registry) =>
          Effect.flatMap(seenOf(database, registry.stream), (after) => registryRead(registry, after, false)),
        { discard: true },
      ),
    playbookSeen: (playbookKey) => playbooks.follow(playbookKey, null),
  };
}

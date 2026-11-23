import { Effect, Schema } from 'effect';

import type { OrgAddress } from '../caller/org-context.ts';
import { OrgReader } from '../ledger/org-reader.ts';

export interface EntityKind<Key, Value, Asked> {
  readonly name: string;
  readonly parentOf: (key: Key) => string;
  readonly key: Schema.Decoder<Key>;
  readonly asked: Schema.Decoder<Asked>;
  readonly value: Schema.Decoder<Value>;
  readonly read: (keys: readonly Key[], asked: Asked) => Effect.Effect<readonly Value[], never, OrgReader>;
}

export type EntitiesRead = <Key, Value, Asked>(
  kind: EntityKind<Key, Value, Asked>,
  keys: readonly Key[],
  asked: Asked,
) => Effect.Effect<readonly Value[]>;

export type EntitiesReadAcross = <Key, Value, Asked>(
  kind: EntityKind<Key, Value, Asked>,
  org: OrgAddress,
  keys: readonly Key[],
  asked: Asked,
) => Effect.Effect<readonly Value[]>;

export interface EntitiesReader {
  readonly readEntities: EntitiesRead;
}

export interface EntitiesSent {
  readonly kind: string;
  readonly keys: readonly unknown[];
  readonly parents: readonly string[];
  readonly asked: unknown;
}

export interface WiredEntityKind {
  readonly name: string;
  readonly readSent: (keys: readonly unknown[], asked: unknown) => Effect.Effect<readonly unknown[], never, OrgReader>;
}

export function entitiesOf<Key, Value, Asked>(
  kind: EntityKind<Key, Value, Asked>,
  keys: readonly Key[],
  asked: Asked,
): Effect.Effect<readonly Value[], never, OrgReader> {
  return OrgReader.use((reader) => reader.readEntities(kind, keys, asked));
}

export function entitiesSentOf<Key, Value, Asked>(
  kind: EntityKind<Key, Value, Asked>,
  keys: readonly Key[],
  asked: Asked,
): EntitiesSent {
  return { kind: kind.name, keys, parents: keys.map((key) => kind.parentOf(key)), asked };
}

export function valuesAnswered<Key, Value, Asked>(
  kind: EntityKind<Key, Value, Asked>,
  answered: readonly unknown[],
): Effect.Effect<readonly Value[]> {
  return Effect.orDie(Schema.decodeUnknownEffect(Schema.Array(kind.value))(answered));
}

export function wiredKindOf<Key, Value, Asked>(kind: EntityKind<Key, Value, Asked>): WiredEntityKind {
  const keysOf = Schema.decodeUnknownEffect(Schema.Array(kind.key));
  const askedOf = Schema.decodeUnknownEffect(kind.asked);
  return {
    name: kind.name,
    readSent: (keys, asked) =>
      Effect.orDie(Effect.all([keysOf(keys), askedOf(asked)])).pipe(
        Effect.flatMap(([decodedKeys, decodedAsked]: readonly [readonly Key[], Asked]) =>
          kind.read(decodedKeys, decodedAsked),
        ),
      ),
  };
}

export function wiredKindNamed(kinds: readonly WiredEntityKind[], name: string): Effect.Effect<WiredEntityKind> {
  const kind = kinds.find((each) => each.name === name);
  return kind === undefined ? Effect.die(new Error(`No entity kind is named ${name}`)) : Effect.succeed(kind);
}

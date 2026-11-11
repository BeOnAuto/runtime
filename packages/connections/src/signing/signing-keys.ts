import { signingKeyOf, type SigningKey } from '@on.auto/identity';
import type { StreamReader } from '@on.auto/operations';
import { DateTime, Effect, Redacted } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { signingSecretsVerifyingAt, type KeptSigning } from '../registry/kept-signing.ts';
import { connectionsFold, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import type { KeptConnection, Registry } from '../registry/registry.ts';

export interface SigningReading {
  readonly ledger: StreamReader;
  readonly secrets: Pick<SecretKeeping, 'read'>;
}

export interface SigningKeys {
  readonly connection: string;
  readonly keys: readonly SigningKey[];
}

export type SigningKeysOf = (org: string, name: string) => Effect.Effect<SigningKeys | undefined>;

export interface IdentifiedSigningKey {
  readonly secretId: string;
  readonly key: SigningKey;
}

export interface NamedSigningKeys {
  readonly connection: string;
  readonly keys: readonly IdentifiedSigningKey[];
}

export type SigningKeysByName = ReadonlyMap<string, NamedSigningKeys>;

export type SigningKeysByNameOf = (org: string) => Effect.Effect<SigningKeysByName>;

function receivingNamed(registry: Registry, name: string) {
  return [...registry.values()].find(({ connection }) => connection.name === name && connection.status !== 'removed');
}

function isSigning(kept: KeptConnection): kept is KeptConnection & { readonly signing: KeptSigning } {
  return kept.connection.status !== 'removed' && kept.signing !== undefined;
}

const noKey: readonly SigningKey[] = [];

function unreadWarning({ detail }: { readonly detail: string }): Effect.Effect<readonly SigningKey[]> {
  return Effect.as(
    Effect.logWarning(
      "A connection's signing secret could not be read, so a delivery signed with it is refused as one signed with no secret",
    ).pipe(Effect.annotateLogs({ because: detail })),
    noKey,
  );
}

function keysIn(value: string): readonly SigningKey[] {
  const key = signingKeyOf(value);
  return key === undefined ? noKey : [key];
}

function keysKeptBy(secrets: SigningReading['secrets']) {
  const kept = new Map<string, SigningKey>();
  const keyRead = (secretId: string) =>
    secrets.read(secretId).pipe(
      Effect.map((row) => (row === undefined ? noKey : keysIn(Redacted.value(row.value)))),
      Effect.catch(unreadWarning),
      Effect.tap((keys) =>
        Effect.sync(() => {
          for (const key of keys) {
            kept.set(secretId, key);
          }
        }),
      ),
    );
  return (secretId: string): Effect.Effect<readonly IdentifiedSigningKey[]> => {
    const known = kept.get(secretId);
    const keys = known === undefined ? keyRead(secretId) : Effect.succeed([known]);
    return Effect.map(keys, (read) => read.map((key) => ({ secretId, key })));
  };
}

function signingRead(reading: SigningReading) {
  const keysOf = keysKeptBy(reading.secrets);
  return (connection: string, signing: KeptSigning | undefined, at: string) =>
    Effect.map(
      Effect.forEach(signingSecretsVerifyingAt(signing, at), keysOf),
      (keys: readonly (readonly IdentifiedSigningKey[])[]): NamedSigningKeys => ({ connection, keys: keys.flat() }),
    );
}

function keysAlone({ connection, keys }: NamedSigningKeys): SigningKeys {
  return { connection, keys: keys.map(({ key }) => key) };
}

function registryAt({ ledger }: SigningReading, org: string) {
  return Effect.all({
    registry: Effect.map(ledger.load(connectionsStreamOfOrg(org), connectionsFold), ({ state }) => state),
    at: Effect.map(DateTime.now, DateTime.formatIso),
  });
}

export function signingKeysOf(reading: SigningReading): SigningKeysOf {
  const signingOf = signingRead(reading);
  return (org, name) =>
    Effect.gen(function* () {
      const { registry, at } = yield* registryAt(reading, org);
      const named = receivingNamed(registry, name);
      return named === undefined ? undefined : keysAlone(yield* signingOf(named.connection.id, named.signing, at));
    });
}

export function signingKeysByNameOf(reading: SigningReading): SigningKeysByNameOf {
  const signingOf = signingRead(reading);
  return (org) =>
    Effect.gen(function* () {
      const { registry, at } = yield* registryAt(reading, org);
      const named = yield* Effect.forEach(
        [...registry.values()].filter((kept) => isSigning(kept)),
        ({ connection, signing }) =>
          Effect.map(signingOf(connection.id, signing, at), (keys) => [connection.name, keys] as const),
      );
      return new Map(named);
    });
}

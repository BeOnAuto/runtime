import { resolve } from 'node:path';

import { Effect } from 'effect';

import type { SecretsKeySource } from '../settings/secrets-settings.ts';

export interface SecretStoreReport {
  readonly kid: string;
  readonly resealed: number;
  readonly keyFrom: SecretsKeySource;
  readonly moved?: number | undefined;
}

export interface ParameterStoreReport {
  readonly prefix: string;
  readonly region: string;
  readonly moved: number;
}

export function keyHeldBy(source: SecretsKeySource): string {
  if (source.from === 'environment') {
    return `that ${source.setting} holds`;
  }
  if (source.from === 'kms') {
    return `that the KMS key ${source.arn} holds`;
  }
  return source.from === 'file' ? `that the file ${resolve(source.file)} holds` : 'that the server made at this start';
}

function movedThere(moved: number | undefined): string {
  return moved === undefined ? '' : `, and ${moved} kept by the previous keeper were moved there`;
}

export function logSecretStore({ kid, resealed, keyFrom, moved }: SecretStoreReport): Effect.Effect<void> {
  return Effect.logInfo(
    `Secrets are kept in the ledger's database, sealed under the key ${kid} ${keyHeldBy(keyFrom)}, and ${resealed} sealed under the previous key were sealed again under it${movedThere(moved)}`,
  ).pipe(
    Effect.annotateLogs({
      secrets_kid: kid,
      secrets_resealed: resealed,
      secrets_key_from: keyFrom.from,
      ...(moved === undefined ? {} : { secrets_moved: moved }),
    }),
  );
}

export function logSecretsInParameterStore({ prefix, region, moved }: ParameterStoreReport): Effect.Effect<void> {
  return Effect.logInfo(
    `Secrets are kept in AWS Parameter Store under ${prefix} in ${region}${movedThere(moved)}`,
  ).pipe(
    Effect.annotateLogs({
      secrets_keeper: 'aws-parameter-store',
      secrets_prefix: prefix,
      secrets_region: region,
      secrets_moved: moved,
    }),
  );
}

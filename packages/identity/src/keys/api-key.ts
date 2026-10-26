import { randomBytes } from 'node:crypto';

import { CallerIdentitySchema, sha256Of } from '@on.auto/operations';
import { Schema } from 'effect';

import { CredentialOrgSchema, localDeveloperId } from '../access/local-org.ts';

const KeyIdSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9-]{1,32}$/u),
  Schema.makeFilter((id: string) => id !== localDeveloperId || 'This key id is reserved for the local developer'),
);

const DigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

export const KeyGrantSchema = Schema.Struct({
  id: KeyIdSchema,
  org: CredentialOrgSchema,
  permissions: CallerIdentitySchema.fields.permissions,
  playbooks: CallerIdentitySchema.fields.playbooks,
});

export type KeyGrant = typeof KeyGrantSchema.Type;

export const ApiKeySchema = Schema.Struct({ ...KeyGrantSchema.fields, sha256: DigestSchema });

export type ApiKey = typeof ApiKeySchema.Type;

export interface CreatedKey {
  readonly key: string;
  readonly entry: ApiKey;
}

const presentedKey = /^abk_([a-z0-9-]{1,32})_[A-Za-z0-9_-]{43}$/u;

export const keyPrefix = 'abk_';

export function keyIdOf(key: string): string | undefined {
  return presentedKey.exec(key)?.[1];
}

export function createApiKey({ id, org, permissions, playbooks }: KeyGrant): CreatedKey {
  const key = `${keyPrefix}${id}_${randomBytes(32).toString('base64url')}`;
  return { key, entry: { id, sha256: sha256Of(key), org, permissions, playbooks } };
}

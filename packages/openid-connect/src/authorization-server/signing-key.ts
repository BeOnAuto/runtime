import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

import { Schema } from 'effect';
import { calculateJwkThumbprint } from 'jose';

import type { SigningKeyRows } from './signing-key-rows.ts';

export const idTokenSigningAlgorithm = 'RS256';

const rsaModulusBits = 2048;

const SigningKeySchema = Schema.Struct({
  kty: Schema.Literal('RSA'),
  kid: Schema.String,
  alg: Schema.Literal(idTokenSigningAlgorithm),
  use: Schema.Literal('sig'),
  n: Schema.String,
  e: Schema.String,
  d: Schema.String,
  p: Schema.String,
  q: Schema.String,
  dp: Schema.String,
  dq: Schema.String,
  qi: Schema.String,
});

export type SigningKey = typeof SigningKeySchema.Type;

const signingKeyFromJson = Schema.decodeUnknownSync(Schema.fromJsonString(SigningKeySchema));

const signingKeyAsJson = Schema.encodeSync(Schema.fromJsonString(SigningKeySchema));

export interface KeptSecrets {
  readonly keep: (value: string) => Promise<string>;
  readonly read: (id: string) => Promise<string | undefined>;
  readonly forget: (id: string) => Promise<void>;
}

const generatedKeyPair = promisify(generateKeyPair);

async function madeSigningKey(): Promise<SigningKey> {
  const { privateKey } = await generatedKeyPair('rsa', { modulusLength: rsaModulusBits });
  const { n = '', e = '', d = '', p = '', q = '', dp = '', dq = '', qi = '' } = privateKey.export({ format: 'jwk' });
  const kid = await calculateJwkThumbprint({ kty: 'RSA', n, e });
  return { kty: 'RSA', kid, alg: idTokenSigningAlgorithm, use: 'sig', n, e, d, p, q, dp, dq, qi };
}

async function keyNamed(secrets: KeptSecrets, secretId: string): Promise<SigningKey | undefined> {
  const kept = await secrets.read(secretId);
  return kept === undefined ? undefined : signingKeyFromJson(kept);
}

async function forgotten(secrets: KeptSecrets, secretId: string): Promise<undefined> {
  await secrets.forget(secretId);
  return undefined;
}

interface Keeping {
  readonly rows: SigningKeyRows;
  readonly secrets: KeptSecrets;
  readonly now: () => number;
}

async function keptInPlaceOf(
  { rows, secrets, now }: Keeping,
  lost: string | undefined,
): Promise<SigningKey | undefined> {
  const made = await madeSigningKey();
  const secretId = await secrets.keep(signingKeyAsJson(made));
  const kept = lost === undefined ? await rows.kept(secretId, now()) : await rows.replaced(secretId, now(), lost);
  return kept ? made : forgotten(secrets, secretId);
}

export async function signingKeyOf(
  rows: SigningKeyRows,
  secrets: KeptSecrets,
  now: () => number = Date.now,
): Promise<SigningKey> {
  const recorded = await rows.found();
  const read = recorded === undefined ? undefined : await keyNamed(secrets, recorded);
  return read ?? (await keptInPlaceOf({ rows, secrets, now }, recorded)) ?? signingKeyOf(rows, secrets, now);
}

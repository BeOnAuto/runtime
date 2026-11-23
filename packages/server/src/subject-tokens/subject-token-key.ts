import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

import { byTheRuntime } from '@on.auto/connections';
import type { RsaSigningKey } from '@on.auto/identity';
import {
  ActedContextSchema,
  Conflict,
  factOf,
  type Context,
  type Decided,
  type Decider,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import type { KeepingFailure, ReadingFailure, SecretRefused, SecretStore } from '@on.auto/secrets';
import { DateTime, Effect, Redacted, Result, Schema } from 'effect';

export const subjectTokenKeyStream = 'runtime/subject-token-signing-key';

export const SubjectTokenKeyEventSchema = Schema.Union([
  factOf('subject_token_signing_key_kept', Schema.Struct({ secret_id: Schema.String }), ActedContextSchema),
]);

export type SubjectTokenKeyEvent = typeof SubjectTokenKeyEventSchema.Type;

export interface SubjectTokenKeyKeeping {
  readonly secret_id: string;
  readonly in_place_of: string | undefined;
  readonly by: string;
  readonly at: string;
}

type KeptSecretId = string | undefined;

export const subjectTokenKeyDecider: Decider<KeptSecretId, SubjectTokenKeyKeeping, SubjectTokenKeyEvent, 'conflict'> = {
  initialState: undefined,
  evolve: (_kept, { data }) => data.secret_id,
  decide: ({ secret_id, in_place_of }, kept): Result.Result<readonly Decided<SubjectTokenKeyEvent>[], Conflict> =>
    kept === in_place_of
      ? Result.succeed([{ type: 'subject_token_signing_key_kept', data: { secret_id } }])
      : Result.fail(new Conflict({ kind: 'taken', detail: 'The runtime keeps a key for subject tokens already' })),
  context: ({ by, at }): Context => ({ by, at }),
  eventSchema: SubjectTokenKeyEventSchema,
};

const RsaSigningKeySchema = Schema.Struct({
  kty: Schema.Literal('RSA'),
  n: Schema.String,
  e: Schema.String,
  d: Schema.String,
  p: Schema.String,
  q: Schema.String,
  dp: Schema.String,
  dq: Schema.String,
  qi: Schema.String,
});

const keyFromJson = Schema.decodeUnknownSync(Schema.fromJsonString(RsaSigningKeySchema));

const keyAsJson = Schema.encodeSync(Schema.fromJsonString(RsaSigningKeySchema));

const rsaModulusBits = 2048;

const generatedKeyPair = promisify(generateKeyPair);

export async function madeRsaSigningKey(): Promise<RsaSigningKey> {
  const { privateKey } = await generatedKeyPair('rsa', { modulusLength: rsaModulusBits });
  return Schema.decodeUnknownSync(RsaSigningKeySchema)(privateKey.export({ format: 'jwk' }));
}

export type SubjectTokenKeyFailure = ReadingFailure | SecretRefused | KeepingFailure;

export interface SubjectTokenKeyServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretStore, 'keep' | 'read' | 'forget'>;
  readonly made?: () => Promise<RsaSigningKey>;
}

function keyIn(
  { secrets }: SubjectTokenKeyServices,
  secretId: string,
): Effect.Effect<RsaSigningKey | undefined, ReadingFailure> {
  return secrets.read(secretId).pipe(
    Effect.map((stored) => (stored === undefined ? undefined : keyFromJson(Redacted.value(stored.value)))),
    Effect.catchTag('secret_key_unknown', () => Effect.undefined),
  );
}

function keptInPlaceOf(
  { registry, secrets, made = madeRsaSigningKey }: SubjectTokenKeyServices,
  lost: KeptSecretId,
): Effect.Effect<RsaSigningKey | undefined, SecretRefused | KeepingFailure> {
  return Effect.gen(function* () {
    const key = yield* Effect.promise(made);
    const secretId = yield* secrets.keep(Redacted.make(keyAsJson(key)));
    const at = DateTime.formatIso(yield* DateTime.now);
    const keeping = { secret_id: secretId, in_place_of: lost, by: byTheRuntime, at };
    return yield* registry.execute(subjectTokenKeyStream, subjectTokenKeyDecider, keeping).pipe(
      Effect.as(key),
      Effect.catch(() => Effect.andThen(secrets.forget(secretId), Effect.undefined)),
    );
  });
}

export function subjectTokenKeyKeptBy(
  services: SubjectTokenKeyServices,
): Effect.Effect<RsaSigningKey, SubjectTokenKeyFailure> {
  return Effect.gen(function* () {
    const { state: recorded } = yield* services.registry.load(subjectTokenKeyStream, subjectTokenKeyDecider);
    const read = recorded === undefined ? undefined : yield* keyIn(services, recorded);
    return read ?? (yield* keptInPlaceOf(services, recorded)) ?? (yield* subjectTokenKeyKeptBy(services));
  });
}

import { Result, Schema } from 'effect';
import { createLocalJWKSet, createRemoteJWKSet, customFetch, type JWTVerifyGetKey } from 'jose';

import { metadataOf } from './issuer-metadata.ts';
import { boundedFetchOf, issuerAnswerMs, UnreadAnswer, type IssuerRequests } from './issuer-requests.ts';

const mostKeySetBytes = 65_536;

const leastRefetchMs = 60_000;

const mostKeySetAgeMs = 600_000;

const IssuerKeySchema = Schema.StructWithRest(Schema.Struct({ kty: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
]);

export const IssuerKeySetSchema = Schema.Struct({ keys: Schema.NonEmptyArray(IssuerKeySchema) });

export type IssuerKeySet = typeof IssuerKeySetSchema.Type;

type IssuerKeys = Result.Result<JWTVerifyGetKey, string>;

export interface IssuerKeySource {
  readonly keysOf: (requests: IssuerRequests, issuer: string) => Promise<IssuerKeys>;
}

async function keySetAt(jwksUri: string, requests: IssuerRequests): Promise<IssuerKeys> {
  const keySet = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: issuerAnswerMs,
    cooldownDuration: leastRefetchMs,
    cacheMaxAge: mostKeySetAgeMs,
    [customFetch]: boundedFetchOf(requests, mostKeySetBytes),
  });
  try {
    await keySet.reload();
  } catch (error) {
    return Result.fail(
      `its key set at ${jwksUri} ${error instanceof UnreadAnswer ? error.message : 'answers no key set'}`,
    );
  }
  return keySet.jwks()?.keys.length === 0
    ? Result.fail(`its key set at ${jwksUri} holds no keys`)
    : Result.succeed(keySet);
}

export const discoveredIssuerKeys: IssuerKeySource = {
  keysOf: async (requests, issuer) => {
    const metadata = await metadataOf(issuer, requests);
    return Result.isFailure(metadata) ? Result.fail(metadata.failure) : keySetAt(metadata.success.jwksUri, requests);
  },
};

export function issuerKeysAt(jwksUri: string): IssuerKeySource {
  return { keysOf: (requests) => keySetAt(jwksUri, requests) };
}

export function issuerKeysGiven({ keys }: IssuerKeySet): IssuerKeySource {
  const keySet = createLocalJWKSet({ keys: [...keys] });
  return { keysOf: () => Promise.resolve(Result.succeed(keySet)) };
}

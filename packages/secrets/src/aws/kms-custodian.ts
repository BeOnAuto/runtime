import {
  DecryptCommand,
  DescribeKeyCommand,
  EncryptCommand,
  KMSClient,
  KMSServiceException,
  type KMSClientConfig,
} from '@aws-sdk/client-kms';
import type { ProxySettings } from '@on.auto/outbound';
import { isThrottlingError } from '@smithy/core/retry';
import { Effect, Option, Redacted, Schema } from 'effect';

import { CustodianRefused, custodianRefused, type CustodianAct } from '../custodians/custodian-refused.ts';
import type { Custodian } from '../custodians/custodian.ts';
import { custodianUnanswered, KeeperUnavailable } from '../keepers/keeper-unavailable.ts';
import type { KeepingFailure } from '../keepers/keeper.ts';
import { answeredWithinItsBound } from '../store/answer-bound.ts';
import { awsWaits, requestHandlerWithin, wordsWithoutTheAccount, type AwsWaits } from './aws-requests.ts';

export type KmsCredentials = NonNullable<KMSClientConfig['credentials']>;

export interface KmsCustodianOptions {
  readonly keyId: string;
  readonly region: string;
  readonly proxy: ProxySettings;
  readonly credentials: KmsCredentials;
  readonly endpoint?: string | undefined;
  readonly waits?: AwsWaits | undefined;
}

export const encryptionContext: Readonly<Record<string, string>> = { 'on.auto/runtime': 'secret data key' };

const keyResource = 'key/';

const aliasResource = 'alias/';

function resourceOf(arn: string): string {
  return arn.slice(arn.lastIndexOf(':') + 1);
}

export function kidOfKey(keyArn: string): string {
  const resource = resourceOf(keyArn);
  return resource.startsWith(keyResource) ? resource.slice(keyResource.length) : resource;
}

function isRefusal(failure: unknown): boolean {
  if (!(failure instanceof KMSServiceException) || failure.$fault !== 'client') {
    return false;
  }
  const { name, message, $metadata } = failure;
  return !isThrottlingError({ name, message, $metadata });
}

function failureOf(kid: string, act: CustodianAct, failure: unknown): KeepingFailure {
  return isRefusal(failure)
    ? custodianRefused(kid, act, wordsWithoutTheAccount(failure))
    : custodianUnanswered(kid, act, wordsWithoutTheAccount(failure));
}

function aliasFailureOf(alias: string, failure: unknown): KeepingFailure {
  const words = wordsWithoutTheAccount(failure);
  return isRefusal(failure)
    ? new CustodianRefused({
        kid: alias,
        detail: `The custodian of the alias ${alias} refused to describe the key it names: ${words}`,
      })
    : new KeeperUnavailable({
        kid: alias,
        detail: `The custodian of the alias ${alias} did not answer a request to describe the key it names: ${words}`,
      });
}

function kmsClientOf({ region, proxy, credentials, endpoint, waits = awsWaits }: KmsCustodianOptions): KMSClient {
  return new KMSClient({
    requestHandler: requestHandlerWithin(proxy, waits),
    credentials,
    region,
    ...(endpoint === undefined ? {} : { endpoint }),
  });
}

interface KmsRequests {
  readonly encrypted: (
    keyArn: string,
    dataKey: Redacted.Redacted<Uint8Array>,
    abortSignal: AbortSignal,
  ) => Promise<string>;
  readonly decrypted: (
    keyArn: string,
    wrapped: string,
    abortSignal: AbortSignal,
  ) => Promise<Redacted.Redacted<Uint8Array>>;
  readonly described: (aliasArn: string, abortSignal: AbortSignal) => Promise<string>;
}

const decodeDescribed = Schema.decodeUnknownSync(Schema.Struct({ KeyMetadata: Schema.Struct({ Arn: Schema.String }) }));

function requestsOf(options: KmsCustodianOptions): KmsRequests {
  const client = kmsClientOf(options);
  return {
    encrypted: async (keyArn, dataKey, abortSignal) => {
      const { CiphertextBlob } = await client.send(
        new EncryptCommand({
          KeyId: keyArn,
          Plaintext: Redacted.value(dataKey),
          EncryptionContext: { ...encryptionContext },
        }),
        { abortSignal },
      );
      return Buffer.from(Option.getOrThrow(Option.fromNullishOr(CiphertextBlob))).toString('base64');
    },
    decrypted: async (keyArn, wrapped, abortSignal) => {
      const { Plaintext } = await client.send(
        new DecryptCommand({
          KeyId: keyArn,
          CiphertextBlob: Buffer.from(wrapped, 'base64'),
          EncryptionContext: { ...encryptionContext },
        }),
        { abortSignal },
      );
      return Redacted.make(Option.getOrThrow(Option.fromNullishOr(Plaintext)));
    },
    described: async (aliasArn, abortSignal) =>
      decodeDescribed(await client.send(new DescribeKeyCommand({ KeyId: aliasArn }), { abortSignal })).KeyMetadata.Arn,
  };
}

function custodianPinnedTo(requests: KmsRequests, keyArn: string): Custodian {
  const kid = kidOfKey(keyArn);
  const asked = <A>(act: CustodianAct, request: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: request, catch: (failure) => failureOf(kid, act, failure) });
  return {
    kid,
    wrap: (dataKey) => asked('wrap', (abortSignal) => requests.encrypted(keyArn, dataKey, abortSignal)),
    unwrap: (wrapped) => asked('unwrap', (abortSignal) => requests.decrypted(keyArn, wrapped, abortSignal)),
  };
}

function keyNamedBy(requests: KmsRequests, aliasArn: string): Effect.Effect<string, KeepingFailure> {
  return answeredWithinItsBound(
    Effect.tryPromise({
      try: (abortSignal) => requests.described(aliasArn, abortSignal),
      catch: (failure) => aliasFailureOf(resourceOf(aliasArn), failure),
    }),
  );
}

export function kmsCustodian(options: KmsCustodianOptions): Effect.Effect<Custodian, KeepingFailure> {
  const { keyId } = options;
  const requests = requestsOf(options);
  return resourceOf(keyId).startsWith(aliasResource)
    ? Effect.map(keyNamedBy(requests, keyId), (keyArn) => custodianPinnedTo(requests, keyArn))
    : Effect.succeed(custodianPinnedTo(requests, keyId));
}

import {
  DeleteParameterCommand,
  GetParameterCommand,
  ParameterTier,
  ParameterType,
  PutParameterCommand,
  SSMClient,
  SSMServiceException,
  type SSMClientConfig,
} from '@aws-sdk/client-ssm';
import type { ProxySettings } from '@on.auto/outbound';
import { loadConfig } from '@smithy/core/config';
import { NODE_RETRY_MODE_CONFIG_OPTIONS, RETRY_MODES } from '@smithy/core/retry';
import { Effect, Redacted, Schema } from 'effect';

import { KeeperUnavailable } from '../keepers/keeper-unavailable.ts';
import type { Keeper } from '../keepers/keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { SecretRefused, type SecretRefusedBecause } from '../store/secret-refused.ts';
import { awsWaits, requestHandlerWithin, wordsWithoutTheAccount, type AwsWaits } from './aws-requests.ts';

const parameterStoreKeeperName = 'aws-parameter-store';

export type ParameterStoreCredentials = NonNullable<SSMClientConfig['credentials']>;

export interface ParameterStoreKeeperOptions {
  readonly prefix: string;
  readonly region: string;
  readonly proxy: ProxySettings;
  readonly credentials: ParameterStoreCredentials;
  readonly endpoint?: string | undefined;
  readonly waits?: AwsWaits | undefined;
}

const mostStandardBytes = 4096;

const gone: ReadonlySet<string> = new Set(['ParameterNotFound', 'ParameterVersionNotFound']);

const refusals: ReadonlyMap<string, SecretRefusedBecause> = new Map([
  ['ParameterLimitExceeded', 'over_the_keepers_quota'],
  ['PoliciesLimitExceededException', 'refused_by_the_keeper'],
  ['ParameterMaxVersionLimitExceeded', 'refused_by_the_keeper'],
  ['ValidationException', 'refused_by_the_keeper'],
]);

const pacedUnlessToldOtherwise = { ...NODE_RETRY_MODE_CONFIG_OPTIONS, default: RETRY_MODES.ADAPTIVE };

const decodeWritten = Schema.decodeUnknownSync(Schema.Struct({ Version: Schema.Number }));

const decodeRead = Schema.decodeUnknownSync(Schema.Struct({ Parameter: Schema.Struct({ Value: Schema.String }) }));

function tierOf(value: Redacted.Redacted): { readonly Tier?: typeof ParameterTier.ADVANCED } {
  return Buffer.byteLength(Redacted.value(value)) > mostStandardBytes ? { Tier: ParameterTier.ADVANCED } : {};
}

function parameterNameOf({ held }: Holding): string {
  return held.slice(0, held.lastIndexOf(':'));
}

function isGone(failure: unknown): boolean {
  return failure instanceof SSMServiceException && gone.has(failure.name);
}

function refusalOf(failure: unknown): SecretRefusedBecause | undefined {
  return failure instanceof SSMServiceException ? refusals.get(failure.name) : undefined;
}

async function unlessGone<A>(asked: Promise<A>): Promise<A | undefined> {
  try {
    return await asked;
  } catch (failure) {
    if (isGone(failure)) {
      return undefined;
    }
    throw failure;
  }
}

function ssmClientOf({
  region,
  proxy,
  credentials,
  endpoint,
  waits = awsWaits,
}: ParameterStoreKeeperOptions): SSMClient {
  return new SSMClient({
    requestHandler: requestHandlerWithin(proxy, waits),
    retryMode: loadConfig(pacedUnlessToldOtherwise),
    credentials,
    region,
    ...(endpoint === undefined ? {} : { endpoint }),
  });
}

function unavailableTo(act: string, parameter: string): (failure: unknown) => KeeperUnavailable {
  return (failure) =>
    new KeeperUnavailable({
      detail: `AWS Parameter Store could not ${act} the parameter ${parameter}: ${wordsWithoutTheAccount(failure)}`,
    });
}

function unwrittenTo(name: string): (failure: unknown) => SecretRefused | KeeperUnavailable {
  return (failure) => {
    const because = refusalOf(failure);
    return because === undefined
      ? unavailableTo('write', name)(failure)
      : new SecretRefused({
          because,
          detail: `AWS Parameter Store refused to keep the parameter ${name}: ${wordsWithoutTheAccount(failure)}`,
        });
  };
}

interface ParameterRequests {
  readonly written: (name: string, value: Redacted.Redacted, abortSignal: AbortSignal) => Promise<Holding>;
  readonly read: (selector: string, abortSignal: AbortSignal) => Promise<Redacted.Redacted | undefined>;
  readonly deleted: (name: string, abortSignal: AbortSignal) => Promise<void>;
}

function requestsOf(options: ParameterStoreKeeperOptions): ParameterRequests {
  const client = ssmClientOf(options);
  return {
    written: async (name, value, abortSignal) => {
      const asked = { Name: name, Value: Redacted.value(value), Type: ParameterType.SECURE_STRING, Overwrite: true };
      const answer = await client.send(new PutParameterCommand({ ...asked, ...tierOf(value) }), { abortSignal });
      return { keptBy: parameterStoreKeeperName, held: `${name}:${decodeWritten(answer).Version}` };
    },
    read: async (selector, abortSignal) => {
      const answer = await unlessGone(
        client.send(new GetParameterCommand({ Name: selector, WithDecryption: true }), { abortSignal }),
      );
      return answer === undefined ? undefined : Redacted.make(decodeRead(answer).Parameter.Value);
    },
    deleted: async (name, abortSignal) => {
      await unlessGone(client.send(new DeleteParameterCommand({ Name: name }), { abortSignal }));
    },
  };
}

export function parameterStoreKeeper(options: ParameterStoreKeeperOptions): Keeper {
  const requests = requestsOf(options);
  return {
    name: parameterStoreKeeperName,
    hold: (id, value) => {
      const name = `${options.prefix}/${id}`;
      return Effect.tryPromise({
        try: (abortSignal) => requests.written(name, value, abortSignal),
        catch: unwrittenTo(name),
      });
    },
    reveal: ({ held }) =>
      Effect.tryPromise({
        try: (abortSignal) => requests.read(held, abortSignal),
        catch: unavailableTo('read', held),
      }),
    release: (holding) => {
      const name = parameterNameOf(holding);
      return Effect.tryPromise({
        try: (abortSignal) => requests.deleted(name, abortSignal),
        catch: unavailableTo('delete', name),
      });
    },
  };
}

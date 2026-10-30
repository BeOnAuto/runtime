import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import type { ProxySettings } from '@on.auto/outbound';
import { awsClientSettingsOf } from '@on.auto/outbound/aws';

export interface StorageEndpoint {
  readonly endpoint: string | undefined;
  readonly region: string | undefined;
  readonly proxy: ProxySettings;
}

export interface StorageWaits {
  readonly connectionMs: number;
  readonly requestMs: number;
}

export type StorageCredentials = NonNullable<S3ClientConfig['credentials']>;

export const storageWaits: StorageWaits = { connectionMs: 5000, requestMs: 60_000 };

export function storageClientOf(
  { endpoint, region, proxy }: StorageEndpoint,
  credentials: StorageCredentials,
  { connectionMs, requestMs }: StorageWaits = storageWaits,
): S3Client {
  const { requestHandler } = awsClientSettingsOf(proxy);
  return new S3Client({
    requestHandler: {
      ...requestHandler,
      connectionTimeout: connectionMs,
      requestTimeout: requestMs,
      throwOnRequestTimeout: true,
    },
    credentials,
    ...(endpoint === undefined ? {} : { endpoint, forcePathStyle: true }),
    ...(region === undefined ? {} : { region }),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

import type { ProxySettings } from '@on.auto/outbound';
import type { Custodian, Keeper, KeepingFailure } from '@on.auto/secrets';
import type { KmsCustodianOptions, ParameterStoreKeeperOptions } from '@on.auto/secrets/aws';
import type { Effect } from 'effect';

export interface AwsAdapters {
  readonly kmsCustodian: (options: KmsCustodianOptions) => Effect.Effect<Custodian, KeepingFailure>;
  readonly parameterStoreKeeper: (options: ParameterStoreKeeperOptions) => Keeper;
}

export type AwsAdaptersLoader = () => Promise<AwsAdapters>;

export const loadAwsAdapters: AwsAdaptersLoader = () => import('@on.auto/secrets/aws');

export interface AwsMaking {
  readonly proxy: ProxySettings;
  readonly loadAws: AwsAdaptersLoader;
}

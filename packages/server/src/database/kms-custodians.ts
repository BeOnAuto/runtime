import type { ProxySettings } from '@on.auto/outbound';
import { awsCredentialChain } from '@on.auto/outbound/aws';
import type { Custodian, KeepingFailure } from '@on.auto/secrets';
import type { KmsCustodianOptions } from '@on.auto/secrets/aws';
import { Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import type { SecretsKeySource } from '../settings/secrets-settings.ts';

export interface KmsCustodians {
  readonly kmsCustodian: (options: KmsCustodianOptions) => Effect.Effect<Custodian, KeepingFailure>;
}

export type KmsCustodiansLoader = () => Promise<KmsCustodians>;

export const loadKmsCustodians: KmsCustodiansLoader = () => import('@on.auto/secrets/aws');

export interface CustodiansMaking {
  readonly proxy: ProxySettings;
  readonly loadKms: KmsCustodiansLoader;
}

export type KeyInKms = Extract<SecretsKeySource, { readonly from: 'kms' }>;

function unresolved({ setting, arn }: KeyInKms, detail: string): InvalidSettingsError {
  const alias = arn.slice(arn.lastIndexOf(':') + 1);
  return new InvalidSettingsError({
    message: `The secrets settings are invalid. ${setting}: The KMS alias ${alias} it names could not be resolved to its key at start: ${detail}`,
  });
}

export async function kmsCustodianOf(source: KeyInKms, { proxy, loadKms }: CustodiansMaking): Promise<Custodian> {
  const { kmsCustodian } = await loadKms();
  const made = kmsCustodian({
    keyId: source.arn,
    region: source.region,
    proxy,
    credentials: awsCredentialChain(proxy),
  });
  return Effect.runPromise(
    Effect.mapError(made, ({ detail }: { readonly detail: string }) => unresolved(source, detail)),
  );
}

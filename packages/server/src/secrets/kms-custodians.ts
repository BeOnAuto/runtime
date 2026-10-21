import { awsCredentialChain } from '@on.auto/outbound/aws';
import type { Custodian } from '@on.auto/secrets';
import { Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import type { SecretsKeySource } from '../settings/secrets-settings.ts';
import type { AwsMaking } from './aws-adapters.ts';

export type KeyInKms = Extract<SecretsKeySource, { readonly from: 'kms' }>;

function unresolved({ setting, arn }: KeyInKms, detail: string): InvalidSettingsError {
  const alias = arn.slice(arn.lastIndexOf(':') + 1);
  return new InvalidSettingsError({
    message: `The secrets settings are invalid. ${setting}: The KMS alias ${alias} it names could not be resolved to its key at start: ${detail}`,
  });
}

export async function kmsCustodianOf(source: KeyInKms, { proxy, loadAws }: AwsMaking): Promise<Custodian> {
  const { kmsCustodian } = await loadAws();
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

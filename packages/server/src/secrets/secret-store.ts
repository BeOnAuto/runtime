import { localCustodian, type Custodian, type Custodians } from '@on.auto/secrets';

import type { SecretsKeySource, SecretsSettings } from '../settings/secrets-settings.ts';
import type { AwsMaking } from './aws-adapters.ts';
import { kmsCustodianOf } from './kms-custodians.ts';
import { keyInHandOf } from './secrets-keys.ts';

function custodianOf(source: SecretsKeySource, making: AwsMaking): Custodian | Promise<Custodian> {
  return source.from === 'kms' ? kmsCustodianOf(source, making) : localCustodian(keyInHandOf(source));
}

export async function custodiansOf({ current, previous }: SecretsSettings, making: AwsMaking): Promise<Custodians> {
  return {
    current: await custodianOf(current, making),
    previous: previous === undefined ? undefined : await custodianOf(previous, making),
  };
}

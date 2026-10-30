import { awsCredentialChainOf } from '@on.auto/outbound';
import { sealedKeeper, type Custodians, type Keeper, type Keepers } from '@on.auto/secrets';
import { Option } from 'effect';

import type { KeeperGiven, KeeperSettings } from '../settings/keeper-settings.ts';
import type { AwsMaking } from './aws-adapters.ts';

async function keeperOf(given: KeeperGiven, custodians: Custodians | undefined, making: AwsMaking): Promise<Keeper> {
  if (given.kind === 'ledger') {
    return sealedKeeper(Option.getOrThrow(Option.fromNullishOr(custodians)));
  }
  const [{ parameterStoreKeeper }, credentials] = await Promise.all([
    making.loadAws(),
    awsCredentialChainOf(making.proxy),
  ]);
  const { prefix, region } = given;
  return parameterStoreKeeper({ prefix, region, proxy: making.proxy, credentials });
}

export async function keepersOf(
  { current, previous }: KeeperSettings,
  custodians: Custodians | undefined,
  making: AwsMaking,
): Promise<Keepers> {
  return {
    current: await keeperOf(current, custodians, making),
    previous: previous === undefined ? undefined : await keeperOf(previous, custodians, making),
  };
}

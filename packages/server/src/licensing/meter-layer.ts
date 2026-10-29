import type { RunMeter } from '@on.auto/definitions';
import type { LedgerServices } from '@on.auto/ledger';
import {
  accountServiceLayer,
  autoSigners,
  ledgerMeter,
  meterDefaults,
  type LicensedFeatures,
  type RuntimeLicense,
  type Signers,
} from '@on.auto/meter';
import { Layer } from 'effect';

import { outboundFetch } from '../composition/outbound-fetch.ts';
import { defaultAccountsOrigin, type LicenseSettings } from './license-settings.ts';

export interface MeterComposing extends LicenseSettings {
  readonly studio: string;
  readonly signers?: Signers;
  readonly features?: Layer.Layer<LicensedFeatures>;
}

export const unlicensed: MeterComposing = {
  studio: meterDefaults.studio,
  accounts: defaultAccountsOrigin,
  key: undefined,
  allocation: undefined,
};

export function meterLayerOver(
  ledger: Layer.Layer<LedgerServices>,
  { studio, accounts, key, signers = autoSigners, features }: MeterComposing,
): Layer.Layer<RunMeter | RuntimeLicense | LicensedFeatures> {
  const account = accountServiceLayer({ origin: accounts, fetch: outboundFetch });
  const metered = ledgerMeter({ ...meterDefaults, studio }, { key, signers }).pipe(
    Layer.provide(ledger),
    Layer.provide(account),
  );
  return features === undefined ? metered : Layer.merge(metered, features);
}

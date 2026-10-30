import { RunMeter, type Meter } from '@on.auto/definitions';
import { Ledger } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { meterAdmitting, type MeteredLedger } from './admitting.ts';
import { admittedByTheAuthority, type AdmissionAuthority } from './authority.ts';

export function meterOver(ledgered: MeteredLedger, authority: AdmissionAuthority): Meter {
  return meterAdmitting(ledgered, (run) => admittedByTheAuthority(authority, run));
}

export function ledgerMeterAdmittedBy(authority: AdmissionAuthority): Layer.Layer<RunMeter, never, Ledger> {
  return Layer.effect(
    RunMeter,
    Effect.map(Effect.service(Ledger), (ledger) => RunMeter.of(meterOver({ ledger }, authority))),
  );
}

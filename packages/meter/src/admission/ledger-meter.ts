import { RunMeter, type Meter } from '@on.auto/definitions';
import { LedgerLog } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { meterAdmitting, meteringOver, type MeteredLedger } from './admitting.ts';
import { admittedByTheAuthority, type AdmissionAuthority } from './authority.ts';
import { meterDefaults, type MeterOptions } from './metering.ts';

export function meterOver(
  ledgered: MeteredLedger,
  options: MeterOptions,
  authority: AdmissionAuthority,
): Effect.Effect<Meter> {
  return Effect.map(meteringOver(ledgered, options), (metering) =>
    meterAdmitting(metering, (run, counting) => admittedByTheAuthority(metering, authority, run, counting)),
  );
}

export function ledgerMeterAdmittedBy(
  authority: AdmissionAuthority,
  options: MeterOptions = meterDefaults,
): Layer.Layer<RunMeter, never, Ledger | LedgerLog> {
  return Layer.effect(
    RunMeter,
    Effect.gen(function* () {
      return RunMeter.of(yield* meterOver({ ledger: yield* Ledger, log: yield* LedgerLog }, options, authority));
    }),
  );
}

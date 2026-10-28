import { RunMeter, type Meter } from '@on.auto/definitions';
import { LedgerLog } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { autoSigners, type Signers } from '../licensing/signed-answers.ts';
import { meterAdmitting, meteringOver, type MeteredLedger } from './admitting.ts';
import { admittedByTheAuthority, repairTakenFrom, type AdmissionAuthority } from './authority.ts';
import { meterDefaults, type MeterOptions } from './metering.ts';

export function meterOver(
  ledgered: MeteredLedger,
  options: MeterOptions,
  authority: AdmissionAuthority,
  signers: Signers = autoSigners,
): Effect.Effect<Meter> {
  return Effect.map(meteringOver(ledgered, options), (metering) =>
    meterAdmitting(
      metering,
      (run, counting) => admittedByTheAuthority(metering, authority, run, counting),
      repairTakenFrom(metering, authority, signers),
    ),
  );
}

export function ledgerMeterAdmittedBy(
  authority: AdmissionAuthority,
  options: MeterOptions = meterDefaults,
  signers: Signers = autoSigners,
): Layer.Layer<RunMeter, never, Ledger | LedgerLog> {
  return Layer.effect(
    RunMeter,
    Effect.gen(function* () {
      const ledgered = { ledger: yield* Ledger, log: yield* LedgerLog };
      return RunMeter.of(yield* meterOver(ledgered, options, authority, signers));
    }),
  );
}

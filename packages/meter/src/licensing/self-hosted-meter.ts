import { RunMeter, type Meter } from '@on.auto/definitions';
import { LedgerLog } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Context, Effect, Layer, Ref } from 'effect';

import { AccountService, type AccountPorts } from '../accounts/account-service.ts';
import { meterAdmitting, meteringOver, type MeteredLedger } from '../admission/admitting.ts';
import { meterDefaults, type MeterOptions } from '../admission/metering.ts';
import { admittedSelfHosted } from './licensed-admission.ts';
import { licensePortsOf, RuntimeLicense, unlicensed, type LicenseGiven, type LicensePorts } from './runtime-license.ts';

export interface SelfHostedMeter {
  readonly meter: Meter;
  readonly license: LicensePorts;
}

export function selfHostedMeterOver(
  ledgered: MeteredLedger & { readonly account: AccountPorts },
  options: MeterOptions,
  { key, signers }: LicenseGiven,
): Effect.Effect<SelfHostedMeter> {
  return Effect.gen(function* () {
    const metering = yield* meteringOver(ledgered, options);
    const inHand = yield* Ref.make(key);
    const licensing = {
      ...metering,
      account: ledgered.account,
      signers,
      keyInHand: Ref.get(inHand),
      keyHeld: (held: string) => Ref.set(inHand, held),
    };
    const meter = meterAdmitting(metering, (run, counting) => admittedSelfHosted(licensing, run, counting));
    return { meter, license: licensePortsOf(licensing) };
  });
}

export function ledgerMeter(
  options: MeterOptions = meterDefaults,
  given: LicenseGiven = unlicensed,
): Layer.Layer<RunMeter | RuntimeLicense, never, Ledger | LedgerLog | AccountService> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const ledgered = { ledger: yield* Ledger, log: yield* LedgerLog, account: yield* AccountService };
      const { meter, license } = yield* selfHostedMeterOver(ledgered, options, given);
      return Context.make(RunMeter, meter).pipe(Context.add(RuntimeLicense, license));
    }),
  );
}

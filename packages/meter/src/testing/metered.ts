import type { Meter, MeteredRun } from '@on.auto/definitions';
import { Effect } from 'effect';

import { meterDefaults, type MeterOptions } from '../admission/metering.ts';
import type { LicenseGiven, LicensePorts } from '../licensing/runtime-license.ts';
import { selfHostedMeterOver } from '../licensing/self-hosted-meter.ts';
import { accountFake, type AccountFake } from './account-fake.ts';
import type { LedgerAt } from './ledgers.ts';
import { meterRuntimeOn, type MeterRuntime } from './meter-runtime.ts';
import { answerOf, runStreamOf, starts, type Answer } from './runs.ts';
import { testSigners } from './test-signing.ts';

export interface MeteredOptions extends Partial<MeterOptions> {
  readonly key?: string | undefined;
  readonly keySource?: Exclude<NonNullable<LicenseGiven['key']>['source'], 'activated'>;
  readonly account?: AccountFake;
}

export interface Metered extends Pick<MeterRuntime, 'executesFail' | 'warnings' | 'at' | 'state'> {
  readonly meter: Meter;
  readonly license: LicensePorts;
  readonly account: AccountFake;
  readonly admitted: (run: MeteredRun) => Promise<Answer>;
  readonly activated: (key: string) => Promise<Answer>;
  readonly held: (key: string) => Promise<void>;
  readonly allocated: (allocation: Parameters<LicensePorts['allocate']>[0]) => Promise<Answer>;
  readonly madeReport: (of?: string) => Promise<Effect.Success<ReturnType<LicensePorts['allocationReport']>>>;
  readonly status: () => Promise<Effect.Success<LicensePorts['status']>>;
  readonly refusedStatus: () => Promise<Answer>;
  readonly refusedReport: (of?: string) => Promise<Answer>;
  readonly refreshed: () => Promise<Answer>;
  readonly reported: () => Promise<Answer>;
  readonly reportDue: () => Promise<boolean>;
  readonly started: (run: string, playbook?: string, org?: string) => Promise<void>;
  readonly restarted: (options: MeteredOptions, meanwhile: () => Promise<void>) => Promise<Metered>;
  readonly dispose: () => Promise<void>;
}

export async function meteredOn(at: LedgerAt, options: MeteredOptions = {}): Promise<Metered> {
  const { key, keySource = 'environment', account = accountFake(), ...meterOptions } = options;
  const metering = meterRuntimeOn(at);
  const { timed, onTheLedger } = metering;
  const { meter, license } = await timed(
    Effect.flatMap(metering.ledgered, (ledgered) =>
      selfHostedMeterOver(
        { ...ledgered, account: account.ports },
        { ...meterDefaults, ...meterOptions },
        { key: key === undefined ? undefined : { key, source: keySource }, signers: testSigners },
      ),
    ),
  );
  return {
    ...metering,
    meter,
    license,
    account,
    admitted: (run) => timed(answerOf(meter.admit(run), 'admitted')),
    activated: (given) => timed(answerOf(license.activate(given), 'activated')),
    held: (given) => timed(license.held(given)),
    allocated: (allocation) => timed(answerOf(license.allocate(allocation), 'allocated')),
    madeReport: (of) => timed(license.allocationReport(of)),
    status: () => timed(license.status),
    refusedStatus: () => timed(answerOf(license.status, 'read')),
    refusedReport: (of) => timed(answerOf(license.allocationReport(of), 'made')),
    refreshed: () => timed(answerOf(license.allocationRefreshed, 'refreshed')),
    reported: () => timed(answerOf(license.reported, 'reported')),
    reportDue: () => timed(license.reportDue),
    started: async (run, playbook, org) => {
      await onTheLedger((ledger) => ledger.execute(runStreamOf(run, playbook, org), starts, null));
    },
    restarted: async (again, meanwhile) => {
      await metering.dispose();
      await meanwhile();
      return meteredOn(at, { ...options, account, ...again });
    },
  };
}

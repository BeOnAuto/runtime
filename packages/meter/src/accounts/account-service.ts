import { Context, type Effect } from 'effect';

import type { Signed } from '../licensing/signed-answers.ts';
import type { OfflineReport } from '../meter-stream/allocation-events.ts';
import type { AccountFailure } from './account-failure.ts';

export interface Usage {
  readonly actions: number;
  readonly through: readonly string[] | null;
  readonly last: string | null;
}

export interface ReportedUsage {
  readonly actions: number;
  readonly last: string | null;
}

export interface InstallationUsage extends ReportedUsage {
  readonly installation: string;
}

export interface Activation {
  readonly entitlement: Signed;
  readonly repair: Signed | null;
}

export interface SignedReport {
  readonly report: OfflineReport;
  readonly signature: string;
}

export interface AccountPorts {
  readonly activate: (key: string, usage: InstallationUsage) => Effect.Effect<Activation, AccountFailure>;
  readonly admit: (key: string, action: string) => Effect.Effect<Signed, AccountFailure>;
  readonly report: (key: string, usage: ReportedUsage) => Effect.Effect<void, AccountFailure>;
  readonly refreshAllocation: (key: string, allocation: string) => Effect.Effect<Signed, AccountFailure>;
  readonly reportAllocation: (key: string, report: SignedReport) => Effect.Effect<string, AccountFailure>;
}

export class AccountService extends Context.Service<AccountService, AccountPorts>()('@on.auto/meter/AccountService') {}

import type { MeteredRun } from '@on.auto/definitions';
import { Context, type Effect } from 'effect';

import type { Signed } from '../licensing/signed-answers.ts';
import type { AccountFailure } from './account-failure.ts';

export interface Usage {
  readonly actions: number;
  readonly through: readonly string[] | null;
  readonly last: string | null;
}

export interface InstallationUsage extends Usage {
  readonly installation: string;
}

export interface Activation {
  readonly entitlement: Signed;
  readonly repair: Signed | null;
}

export interface AccountPorts {
  readonly activate: (key: string, usage: InstallationUsage) => Effect.Effect<Activation, AccountFailure>;
  readonly admit: (key: string, run: MeteredRun) => Effect.Effect<Signed, AccountFailure>;
  readonly report: (key: string, usage: Usage) => Effect.Effect<void, AccountFailure>;
}

export class AccountService extends Context.Service<AccountService, AccountPorts>()('@on.auto/meter/AccountService') {}

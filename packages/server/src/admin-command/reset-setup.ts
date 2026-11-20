import { Ledger } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { setupReopened, SignOutUnconfirmed, type Reopening as SettingUpAgain } from '../sign-in/setup.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import {
  ledgerChanged,
  ledgerRead,
  out,
  refused,
  setupGivenBySetting,
  setupNotTied,
  setupStartedOver,
  signOutUnconfirmed,
  type Said,
} from './admin-words.ts';
import { byACommand, type Opened, type OpeningOf } from './opened-for-a-command.ts';

interface Reopening extends Pick<Opened, 'settings' | 'runtime'> {
  readonly signIn: Pick<SettingUpAgain, 'providerRows'>;
}

function valueGivenIn({ openIdConnect, openIdConnectByDefault }: Opened['settings']): boolean {
  return (openIdConnect ?? openIdConnectByDefault)?.requiredClaim?.requiredValue !== undefined;
}

async function startedOverIn({ settings, runtime, signIn }: Reopening): Promise<Said> {
  const reopening = Effect.flatMap(Effect.service(Ledger), (registry) =>
    setupReopened({ registry, providerRows: signIn.providerRows }, byACommand),
  );
  const reopened = await Effect.runPromise(Effect.result(inRuntime(runtime, reopening)));
  if (Result.isFailure(reopened)) {
    const { failure } = reopened;
    return refused(failure instanceof SignOutUnconfirmed ? signOutUnconfirmed(failure.message) : ledgerChanged);
  }
  return reopened.success ? out(...setupStartedOver) : out(setupNotTied, ledgerRead(settings.ledger));
}

export function setupStartedOverBy(settings: Opened['settings'], open: OpeningOf<Reopening>): Promise<Said> {
  return valueGivenIn(settings) ? Promise.resolve(refused(setupGivenBySetting)) : open(startedOverIn);
}

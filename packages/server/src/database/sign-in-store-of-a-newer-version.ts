import { AuthLayoutRefused } from '@on.auto/openid-connect';
import { Data } from 'effect';

import { whereTheLedgerIsKept } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { messageOf, type LedgerRemedy } from './ledger-remedies.ts';

interface NewerLayout {
  readonly found: number;
  readonly kept: number;
}

export class SignInStoreOfANewerVersion extends Data.TaggedError('SignInStoreOfANewerVersion')<
  NewerLayout & { readonly happened: string; readonly remedy: LedgerRemedy; readonly message: string }
> {}

const goingBack: LedgerRemedy = {
  says: 'Start the version of Auto Runtime that made the sign-in tables, or a later one. To go back to this version, restore the backup taken before the upgrade.',
  command: undefined,
};

function signInStoreOfANewerVersion({ found, kept }: NewerLayout, { ledger }: Pick<Settings, 'ledger'>) {
  const happened = `${whereTheLedgerIsKept(ledger)}, and its sign-in tables were made by a newer version of Auto Runtime. This version keeps them in layout ${kept} and cannot read them in layout ${found}: upgrades go forward only.`;
  return new SignInStoreOfANewerVersion({
    found,
    kept,
    happened,
    remedy: goingBack,
    message: messageOf(happened, goingBack),
  });
}

function newerLayoutIn(failure: unknown): NewerLayout | undefined {
  return failure instanceof AuthLayoutRefused && failure.found !== undefined && failure.found > failure.kept
    ? { found: failure.found, kept: failure.kept }
    : undefined;
}

export function signInStoreRefusalExplained(failure: unknown, settings: Pick<Settings, 'ledger'>): unknown {
  const newer = newerLayoutIn(failure);
  return newer === undefined ? failure : signInStoreOfANewerVersion(newer, settings);
}

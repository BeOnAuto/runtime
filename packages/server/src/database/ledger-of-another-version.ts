import type { LedgerLayoutRefused } from '@on.auto/ledger';
import { Data } from 'effect';

import { whereTheLedgerIsKept, type LedgerSettings } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { LedgerOfUnknownFacts } from './ledger-of-unknown-facts.ts';
import { messageOf, remedyFor, type LedgerRemedy } from './ledger-remedies.ts';

type RefusedLayout = Pick<LedgerLayoutRefused, 'found' | 'kept' | 'floor'>;

export class LedgerOfAnotherVersion extends Data.TaggedError('LedgerOfAnotherVersion')<
  RefusedLayout & { readonly happened: string; readonly remedy: LedgerRemedy; readonly message: string }
> {}

function isNewer({ found, kept }: RefusedLayout): boolean {
  return found !== undefined && found > kept;
}

function aLedgerIn(found: number | undefined): string {
  return found === undefined ? 'a ledger that carries no layout number' : `a ledger in layout ${found}`;
}

function whatHappened(ledger: LedgerSettings, refused: RefusedLayout): string {
  const { found, kept, floor } = refused;
  return isNewer(refused)
    ? `${whereTheLedgerIsKept(ledger)}, and was made by a newer version of Auto Runtime. This version keeps the ledger in layout ${kept} and cannot read ${aLedgerIn(found)}: upgrades go forward only.`
    : `${whereTheLedgerIsKept(ledger)}, and was made by an earlier version of Auto Runtime, whose ledger this version does not carry forward. This version keeps the ledger in layout ${kept} and carries forward a ledger in layout ${floor} or later, so it cannot read ${aLedgerIn(found)}.`;
}

const goingBack: LedgerRemedy = {
  says: 'Start the version of Auto Runtime that made the ledger, or a later one. To go back to this version, restore the backup taken before the upgrade.',
  command: undefined,
};

export function ledgerOfAnotherVersion(
  refused: RefusedLayout,
  settings: Pick<Settings, 'ledger' | 'distribution'>,
): LedgerOfAnotherVersion {
  const happened = whatHappened(settings.ledger, refused);
  const remedy = isNewer(refused) ? goingBack : remedyFor(settings);
  return new LedgerOfAnotherVersion({
    found: refused.found,
    kept: refused.kept,
    floor: refused.floor,
    happened,
    remedy,
    message: messageOf(happened, remedy),
  });
}

export function ledgerOfAnotherVersionIn(failure: unknown): LedgerOfAnotherVersion | LedgerOfUnknownFacts | undefined {
  if (failure instanceof LedgerOfAnotherVersion || failure instanceof LedgerOfUnknownFacts) {
    return failure;
  }
  return failure instanceof Error ? ledgerOfAnotherVersionIn(failure.cause) : undefined;
}

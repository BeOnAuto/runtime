import { accessSync } from 'node:fs';

import { LedgerOfAnotherVersion } from '../database/ledger-of-another-version.ts';
import { ledgerRefusalIn } from '../database/ledger-refusals.ts';
import { resolvedLedgerFile, type LedgerSettings } from '../settings/ledger-settings.ts';
import { ledgerNotOpened, ledgerOfAnEarlierVersion, refused, type Said } from './admin-words.ts';

export function ledgerFoundIn(ledger: LedgerSettings): void {
  if (ledger.store === 'sqlite') {
    accessSync(resolvedLedgerFile(ledger.file));
  }
}

function isOfAnEarlierVersion(refusal: unknown): boolean {
  return refusal instanceof LedgerOfAnotherVersion && refusal.found !== undefined && refusal.found < refusal.kept;
}

function messageOf(failure: unknown): string {
  return String(Reflect.get(new Object(failure), 'message'));
}

export function ledgerNotOpenedFor(failure: unknown, ledger: LedgerSettings): Said {
  const refusal = ledgerRefusalIn(failure);
  if (isOfAnEarlierVersion(refusal)) {
    return refused(ledgerNotOpened(ledgerOfAnEarlierVersion(ledger)));
  }
  return refused(ledgerNotOpened(refusal === undefined ? messageOf(failure) : refusal.message));
}

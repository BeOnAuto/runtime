import { LedgerOfAnotherVersion } from './ledger-of-another-version.ts';
import { LedgerOfContentNotFound } from './ledger-of-content-not-found.ts';
import { LedgerOfUnknownFacts } from './ledger-of-unknown-facts.ts';
import { SignInStoreOfANewerVersion } from './sign-in-store-of-a-newer-version.ts';

export type LedgerRefusal =
  | LedgerOfAnotherVersion
  | LedgerOfUnknownFacts
  | LedgerOfContentNotFound
  | SignInStoreOfANewerVersion;

function isALedgerRefusal(failure: unknown): failure is LedgerRefusal {
  return (
    failure instanceof LedgerOfAnotherVersion ||
    failure instanceof LedgerOfUnknownFacts ||
    failure instanceof LedgerOfContentNotFound ||
    failure instanceof SignInStoreOfANewerVersion
  );
}

export function ledgerRefusalIn(failure: unknown): LedgerRefusal | undefined {
  if (isALedgerRefusal(failure)) {
    return failure;
  }
  return failure instanceof Error ? ledgerRefusalIn(failure.cause) : undefined;
}

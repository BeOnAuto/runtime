import type { UnreadableFact } from '@on.auto/ledger';
import { Data } from 'effect';

import { whereTheLedgerIsKept } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { messageOf, remedyFor, type LedgerRemedy } from './ledger-remedies.ts';

interface RefusedFacts {
  readonly unknown: readonly string[];
  readonly unreadable: readonly UnreadableFact[];
}

export class LedgerOfUnknownFacts extends Data.TaggedError('LedgerOfUnknownFacts')<
  RefusedFacts & { readonly happened: string; readonly remedy: LedgerRemedy; readonly message: string }
> {}

function typesNamed(unknown: readonly string[]): string {
  return `${unknown.length === 1 ? 'the type' : 'the types'} ${unknown.join(', ')}`;
}

function factsNamed(unreadable: readonly UnreadableFact[]): string {
  const named = unreadable.map(({ type, position }) => `${type} at position ${position}`).join(', ');
  return `${unreadable.length === 1 ? 'the fact' : 'the facts'} ${named}`;
}

function whatIsHeld({ unknown, unreadable }: RefusedFacts): string {
  return [
    ...(unknown.length === 0
      ? []
      : [`facts of ${typesNamed(unknown)}, which this version of Auto Runtime does not read`]),
    ...(unreadable.length === 0
      ? []
      : [`${factsNamed(unreadable)}, in a shape this version of Auto Runtime does not read`]),
  ].join(', and ');
}

function goingBackOr(earlier: LedgerRemedy): LedgerRemedy {
  return {
    says: `If a newer version of Auto Runtime made the ledger, start that version or a later one, or restore the backup taken before the upgrade. A ledger an earlier version made is not carried forward: ${earlier.says}`,
    command: earlier.command,
  };
}

export function ledgerOfUnknownFacts(
  { unknown, unreadable }: RefusedFacts,
  settings: Pick<Settings, 'ledger' | 'distribution'>,
): LedgerOfUnknownFacts {
  const happened = `${whereTheLedgerIsKept(settings.ledger)}, and holds ${whatIsHeld({ unknown, unreadable })}: it was made by a newer version, or by an earlier version than this one carries forward.`;
  const remedy = goingBackOr(remedyFor(settings));
  return new LedgerOfUnknownFacts({ unknown, unreadable, happened, remedy, message: messageOf(happened, remedy) });
}

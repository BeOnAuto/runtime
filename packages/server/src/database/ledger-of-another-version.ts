import { resolve } from 'node:path';

import type { RefusedShape } from '@on.auto/ledger';
import { Data } from 'effect';

import type { LedgerSettings } from '../settings/ledger-settings.ts';

export type LedgerPlace =
  | { readonly store: 'sqlite'; readonly file: string }
  | { readonly store: 'postgresql'; readonly database: string; readonly host: string };

export class LedgerOfAnotherVersion extends Data.TaggedError('LedgerOfAnotherVersion')<
  RefusedShape & { readonly place: LedgerPlace; readonly message: string }
> {}

export interface LedgerRemedy {
  readonly says: string;
  readonly command: string | undefined;
}

export const discordInvite = 'https://discord.gg/B8BKcKMRm8';

export function helpOfferedAt(invite: string): string {
  return `Need a hand? Ask us on Discord: ${invite}`;
}

const unquotedInAShell = /^[\w./@%+=:,-]+$/u;

function shellWord(text: string): string {
  return unquotedInAShell.test(text) ? text : `'${text.replaceAll("'", String.raw`'\''`)}'`;
}

function placeOf(ledger: LedgerSettings): LedgerPlace {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: resolve(ledger.file) }
    : { store: 'postgresql', database: ledger.database, host: ledger.host };
}

function whereKept(place: LedgerPlace): string {
  return place.store === 'sqlite'
    ? `at ${place.file}`
    : `in the PostgreSQL database ${place.database} on ${place.host}`;
}

export function whatHappened({ place, holds }: Pick<LedgerOfAnotherVersion, 'place' | 'holds'>): string {
  return `The ledger ${whereKept(place)} was made by another version of Auto Runtime. This version keeps ${holds} in a different shape, and it does not yet carry a ledger over from one version to the next.`;
}

export function columnsCompared({ table, found, kept }: RefusedShape): string {
  return `${table} has the columns ${found.join(', ')}, where this version keeps ${kept.join(', ')}.`;
}

export function remedyFor(place: LedgerPlace): LedgerRemedy {
  return place.store === 'sqlite'
    ? {
        says: 'Delete the ledger and start Auto Runtime again. Every playbook, definition and run it holds goes with it, so if it holds work you want to keep, ask us before you delete it.',
        command: `rm -f ${shellWord(place.file)}{,-wal,-shm}`,
      }
    : {
        says: 'Point DATABASE_URL at an empty database, or empty this one, and start Auto Runtime again. The ledger then starts with no playbooks, definitions or runs, so if this one holds work you want to keep, ask us before you do.',
        command: undefined,
      };
}

export function ledgerOfAnotherVersion(shape: RefusedShape, ledger: LedgerSettings): LedgerOfAnotherVersion {
  const place = placeOf(ledger);
  const { says, command } = remedyFor(place);
  const deleting = command === undefined ? [] : [`To delete the ledger, run: ${command}`];
  return new LedgerOfAnotherVersion({
    ...shape,
    place,
    message: [
      whatHappened({ place, holds: shape.holds }),
      columnsCompared(shape),
      says,
      helpOfferedAt(discordInvite),
      ...deleting,
    ].join(' '),
  });
}

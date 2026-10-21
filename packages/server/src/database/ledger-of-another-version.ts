import { basename, dirname } from 'node:path';

import type { LedgerLayoutRefused } from '@on.auto/ledger';
import { Data } from 'effect';

import { discordInvite } from '../command-line/local-banner.ts';
import { resolvedLedgerFile, whereTheLedgerIsKept, type LedgerSettings } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';

interface LedgerRemedy {
  readonly says: string;
  readonly command: string | undefined;
}

type RefusedLayout = Pick<LedgerLayoutRefused, 'found' | 'kept'>;

export class LedgerOfAnotherVersion extends Data.TaggedError('LedgerOfAnotherVersion')<
  RefusedLayout & { readonly happened: string; readonly remedy: LedgerRemedy; readonly message: string }
> {}

export function helpOfferedAt(invite: string): string {
  return `Need a hand? Ask us on Discord: ${invite}`;
}

const unquotedInAShell = /^[\w./@%+=:,-]+$/u;

function shellWord(text: string): string {
  return unquotedInAShell.test(text) ? text : `'${text.replaceAll("'", String.raw`'\''`)}'`;
}

function aLedgerIn(found: number | undefined): string {
  return found === undefined ? 'a ledger that carries no layout number' : `a ledger in layout ${found}`;
}

function whatHappened(ledger: LedgerSettings, { found, kept }: RefusedLayout): string {
  return `${whereTheLedgerIsKept(ledger)}, and was made by another version of Auto Runtime. This version keeps the ledger in layout ${kept} and cannot read ${aLedgerIn(found)}.`;
}

const everythingInItGoes =
  'Everything in the ledger goes with it, every playbook, definition, run and connection among it.';

function deletingTheFiles(file: string): LedgerRemedy {
  return {
    says: `Delete the ledger and start Auto Runtime again. ${everythingInItGoes}`,
    command: `rm -f ${[file, `${file}-wal`, `${file}-shm`].map((word) => shellWord(word)).join(' ')}`,
  };
}

const ledgerFolderOfTheImage = '/app/data';

function volumeHolding(folder: string): string {
  return folder === ledgerFolderOfTheImage
    ? `the volume mounted at /data, the ledger's folder ${folder} in the image`
    : `the volume that holds ${folder}`;
}

function deletingTheFilesOnTheVolume(file: string): LedgerRemedy {
  const name = basename(file);
  return {
    says: `Delete ${name}, ${name}-wal and ${name}-shm from ${volumeHolding(dirname(file))}, or remove the volume, and start Auto Runtime again. ${everythingInItGoes}`,
    command: undefined,
  };
}

const emptyingTheDatabase: LedgerRemedy = {
  says: 'Point DATABASE_URL at an empty database, or empty this one, and start Auto Runtime again. The ledger then starts with no playbooks, definitions or runs.',
  command: undefined,
};

function remedyFor({ ledger, distribution }: Pick<Settings, 'ledger' | 'distribution'>): LedgerRemedy {
  if (ledger.store === 'postgresql') {
    return emptyingTheDatabase;
  }
  const file = resolvedLedgerFile(ledger.file);
  return distribution === 'docker' ? deletingTheFilesOnTheVolume(file) : deletingTheFiles(file);
}

export function ledgerOfAnotherVersion(
  refused: RefusedLayout,
  settings: Pick<Settings, 'ledger' | 'distribution'>,
): LedgerOfAnotherVersion {
  const happened = whatHappened(settings.ledger, refused);
  const remedy = remedyFor(settings);
  const deleting = remedy.command === undefined ? [] : [`To delete the ledger, run: ${remedy.command}`];
  return new LedgerOfAnotherVersion({
    found: refused.found,
    kept: refused.kept,
    happened,
    remedy,
    message: [happened, remedy.says, helpOfferedAt(discordInvite), ...deleting].join(' '),
  });
}

export function ledgerOfAnotherVersionIn(failure: unknown): LedgerOfAnotherVersion | undefined {
  if (failure instanceof LedgerOfAnotherVersion) {
    return failure;
  }
  return failure instanceof Error ? ledgerOfAnotherVersionIn(failure.cause) : undefined;
}

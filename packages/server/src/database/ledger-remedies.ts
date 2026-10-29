import { basename, dirname } from 'node:path';

import { discordInvite } from '../command-line/local-banner.ts';
import { resolvedLedgerFile } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';

export interface LedgerRemedy {
  readonly says: string;
  readonly command: string | undefined;
}

export function helpOfferedAt(invite: string): string {
  return `Need a hand? Ask us on Discord: ${invite}`;
}

const unquotedInAShell = /^[\w./@%+=:,-]+$/u;

function shellWord(text: string): string {
  return unquotedInAShell.test(text) ? text : `'${text.replaceAll("'", String.raw`'\''`)}'`;
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

export function remedyFor({ ledger, distribution }: Pick<Settings, 'ledger' | 'distribution'>): LedgerRemedy {
  if (ledger.store === 'postgresql') {
    return emptyingTheDatabase;
  }
  const file = resolvedLedgerFile(ledger.file);
  return distribution === 'docker' ? deletingTheFilesOnTheVolume(file) : deletingTheFiles(file);
}

export function messageOf(happened: string, remedy: LedgerRemedy): string {
  const deleting = remedy.command === undefined ? [] : [`To delete the ledger, run: ${remedy.command}`];
  return [happened, remedy.says, helpOfferedAt(discordInvite), ...deleting].join(' ');
}

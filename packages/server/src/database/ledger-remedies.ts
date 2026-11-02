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

const everythingInItGoes = 'Deleting the ledger removes all its playbooks, definitions, runs and connections.';

function deletingTheFiles(file: string): LedgerRemedy {
  return {
    says: `To start over, back up the ledger, then delete it and restart Auto Runtime. ${everythingInItGoes}`,
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
    says: `To start over, back up the volume, then delete ${name}, ${name}-wal and ${name}-shm from ${volumeHolding(dirname(file))}, or remove the volume. Restart Auto Runtime afterward. ${everythingInItGoes}`,
    command: undefined,
  };
}

const emptyingTheDatabase: LedgerRemedy = {
  says: 'To start over, point DATABASE_URL at a separate empty database and restart Auto Runtime. You can also back up and empty the current database. The new ledger contains no playbooks, definitions, runs or connections.',
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

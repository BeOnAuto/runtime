import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerOfAnotherVersion } from './ledger-of-another-version.ts';

const secretsOfAnOlderShape = {
  table: 'kept_secrets',
  holds: 'secrets',
  found: ['held', 'id', 'kept_at', 'kept_by', 'version'],
  kept: ['claimed_until', 'ends_with', 'held', 'id', 'kept_at', 'kept_by', 'kid', 'version', 'wrapped_key'],
};

const inPostgreSQL = {
  store: 'postgresql',
  url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com/auto_runtime'),
  host: 'db.example.com:5432',
  database: 'auto_runtime',
  credentials: { kind: 'url' },
} as const;

function refusedFileAt(file: string, distribution: 'npx' | 'docker' = 'npx') {
  return ledgerOfAnotherVersion(secretsOfAnOlderShape, { ledger: { store: 'sqlite', file }, distribution });
}

const awkwardFolder = "Application Support/ada's $HOME";

describe('a ledger made by another version of Auto Runtime', () => {
  it('says in one message where the ledger is, why it is refused, what to do and where to ask, ending with the command that deletes it', () => {
    const refused = refusedFileAt('/Users/ada/.auto-runtime/ledger.db');

    expect(refused.message).toBe(
      'The ledger is kept in the file /Users/ada/.auto-runtime/ledger.db, and was made by another version of Auto Runtime. This version keeps secrets in a different shape and cannot read the secrets this ledger holds. kept_secrets has the columns held, id, kept_at, kept_by, version, where this version keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Delete the ledger and start Auto Runtime again. Everything in the ledger goes with it, every playbook, definition, run and connection among it. Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8 To delete the ledger, run: rm -f /Users/ada/.auto-runtime/ledger.db /Users/ada/.auto-runtime/ledger.db-wal /Users/ada/.auto-runtime/ledger.db-shm',
    );
    expect(String(refused)).toMatch(/^LedgerOfAnotherVersion: The ledger is kept in the file /u);
  });

  it('places a ledger file given as a relative path in the directory the server started in', () => {
    const file = join(process.cwd(), 'data', 'ledger.db');

    const refused = refusedFileAt('data/ledger.db');

    expect(refused.happened).toContain(`The ledger is kept in the file ${file}, and was made by another version`);
    expect(refused.remedy.command).toBe(`rm -f ${file} ${file}-wal ${file}-shm`);
  });

  it('names the PostgreSQL database and its host, never the URL, and says to point DATABASE_URL at an empty one', () => {
    const refused = ledgerOfAnotherVersion(secretsOfAnOlderShape, { ledger: inPostgreSQL, distribution: 'npx' });

    expect(refused.message).toBe(
      'The ledger is kept in PostgreSQL, in the database auto_runtime on db.example.com:5432, and was made by another version of Auto Runtime. This version keeps secrets in a different shape and cannot read the secrets this ledger holds. kept_secrets has the columns held, id, kept_at, kept_by, version, where this version keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Point DATABASE_URL at an empty database, or empty this one, and start Auto Runtime again. The ledger then starts with no playbooks, definitions or runs. Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
    );
    expect(refused.remedy.command).toBeUndefined();
    expect(refused.message).not.toContain('a-secret-password');
  });

  it('says in the image which files to delete from the volume, with no command for a container that has stopped', () => {
    const refused = refusedFileAt('/app/data/ledger.db', 'docker');

    expect(refused.remedy).toEqual({
      says: "Delete ledger.db, ledger.db-wal and ledger.db-shm from the volume mounted at /data, the ledger's folder /app/data in the image, or remove the volume, and start Auto Runtime again. Everything in the ledger goes with it, every playbook, definition, run and connection among it.",
      command: undefined,
    });
    expect(refused.message).toBe(
      "The ledger is kept in the file /app/data/ledger.db, and was made by another version of Auto Runtime. This version keeps secrets in a different shape and cannot read the secrets this ledger holds. kept_secrets has the columns held, id, kept_at, kept_by, version, where this version keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Delete ledger.db, ledger.db-wal and ledger.db-shm from the volume mounted at /data, the ledger's folder /app/data in the image, or remove the volume, and start Auto Runtime again. Everything in the ledger goes with it, every playbook, definition, run and connection among it. Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8",
    );
  });
});

describe('the words for a ledger file of another version in the image', () => {
  it('name the volume the image mounts at /data when the ledger is kept in its folder /app/data', () => {
    expect(refusedFileAt('/app/data/ledger.db', 'docker').remedy.says).toMatch(
      /^Delete ledger\.db, ledger\.db-wal and ledger\.db-shm from the volume mounted at \/data, the ledger's folder \/app\/data in the image, or remove the volume, /u,
    );
  });

  it('name only the folder of a ledger kept anywhere else, from the volume that holds it', () => {
    expect(refusedFileAt('/mnt/ledger/runtime.db', 'docker').remedy).toEqual({
      says: 'Delete runtime.db, runtime.db-wal and runtime.db-shm from the volume that holds /mnt/ledger, or remove the volume, and start Auto Runtime again. Everything in the ledger goes with it, every playbook, definition, run and connection among it.',
      command: undefined,
    });
  });
});

describe('the command that deletes a ledger file of another version', () => {
  it('names the file and the two beside it one by one, each quoted where a shell would split it or read a $ in it', () => {
    expect(refusedFileAt(`/Users/ada/${awkwardFolder}/ledger.db`).remedy.command).toBe(
      String.raw`rm -f '/Users/ada/Application Support/ada'\''s $HOME/ledger.db' '/Users/ada/Application Support/ada'\''s $HOME/ledger.db-wal' '/Users/ada/Application Support/ada'\''s $HOME/ledger.db-shm'`,
    );
  });

  it('deletes in sh exactly the ledger file and the two beside it, on a path with a space, a quote and a $', () => {
    const top = mkdtempSync(join(tmpdir(), 'auto-runtime-ledger-'));
    onTestFinished(() => {
      rmSync(top, { recursive: true, force: true });
    });
    const folder = join(top, awkwardFolder);
    mkdirSync(folder, { recursive: true });
    for (const name of ['ledger.db', 'ledger.db-wal', 'ledger.db-shm', 'ledger.db-journal', 'secrets.key']) {
      writeFileSync(join(folder, name), name);
    }

    execFileSync('/bin/sh', ['-c', String(refusedFileAt(join(folder, 'ledger.db')).remedy.command)]);

    expect(readdirSync(folder).toSorted()).toEqual(['ledger.db-journal', 'secrets.key']);
  });
});

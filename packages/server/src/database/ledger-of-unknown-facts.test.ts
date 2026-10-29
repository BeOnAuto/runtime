import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerOfAnotherVersion, ledgerOfAnotherVersionIn } from './ledger-of-another-version.ts';
import { ledgerOfUnknownFacts } from './ledger-of-unknown-facts.ts';

const inPostgreSQL = {
  store: 'postgresql',
  url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com/auto_runtime'),
  host: 'db.example.com:5432',
  database: 'auto_runtime',
  credentials: { kind: 'url' },
} as const;

const askedAt = 'Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8';

const eitherVersion =
  'which this version of Auto Runtime does not read: it was made by a newer version, or by an earlier version than this one carries forward.';

const goingBackFirst =
  'If a newer version of Auto Runtime made the ledger, start that version or a later one, or restore the backup taken before the upgrade. A ledger an earlier version made is not carried forward:';

const goesWithIt = 'Everything in the ledger goes with it, every playbook, definition, run and connection among it.';

describe('a ledger that holds facts of types this version of Auto Runtime does not read', () => {
  it('names each type, says a newer or an earlier version made it, and what to do for each, ending with the command that deletes a file', () => {
    const inTheFile = ledgerOfUnknownFacts(
      { unknown: ['metering_faulted'], unreadable: [] },
      {
        ledger: { store: 'sqlite', file: '/data/ledger.db' },
        distribution: 'npx',
      },
    );

    expect(inTheFile.message).toBe(
      `The ledger is kept in the file /data/ledger.db, and holds facts of the type metering_faulted, ${eitherVersion} ${goingBackFirst} Delete the ledger and start Auto Runtime again. ${goesWithIt} ${askedAt} To delete the ledger, run: rm -f /data/ledger.db /data/ledger.db-wal /data/ledger.db-shm`,
    );
    expect(inTheFile.unknown).toEqual(['metering_faulted']);
    expect(String(inTheFile)).toMatch(/^LedgerOfUnknownFacts: The ledger is kept in the file /u);
  });

  it('names the database it is kept in, never its URL, and says what to do in the database or in the image', () => {
    const inTheDatabase = ledgerOfUnknownFacts(
      { unknown: ['license_refreshed', 'metering_faulted'], unreadable: [] },
      {
        ledger: inPostgreSQL,
        distribution: 'npx',
      },
    );
    const inTheImage = ledgerOfUnknownFacts(
      { unknown: ['metering_faulted'], unreadable: [] },
      {
        ledger: { store: 'sqlite', file: '/app/data/ledger.db' },
        distribution: 'docker',
      },
    );

    expect(inTheDatabase.message).toBe(
      `The ledger is kept in PostgreSQL, in the database auto_runtime on db.example.com:5432, and holds facts of the types license_refreshed, metering_faulted, ${eitherVersion} ${goingBackFirst} Point DATABASE_URL at an empty database, or empty this one, and start Auto Runtime again. The ledger then starts with no playbooks, definitions or runs. ${askedAt}`,
    );
    expect(inTheDatabase.message).not.toContain('a-secret-password');
    expect(inTheImage).toMatchObject({
      happened: `The ledger is kept in the file /app/data/ledger.db, and holds facts of the type metering_faulted, ${eitherVersion}`,
      remedy: { command: undefined },
    });
  });
});

describe('a ledger whose newest fact of a type is in a shape this version of Auto Runtime does not read', () => {
  it('names the fact and its position, beside any type it does not read', () => {
    const inAnEarlierShape = ledgerOfUnknownFacts(
      { unknown: [], unreadable: [{ type: 'license_activated', position: '1204' }] },
      { ledger: inPostgreSQL, distribution: 'npx' },
    );
    const both = ledgerOfUnknownFacts(
      {
        unknown: ['metering_faulted'],
        unreadable: [
          { type: 'license_activated', position: '1204' },
          { type: 'connection_added', position: '77' },
        ],
      },
      { ledger: inPostgreSQL, distribution: 'npx' },
    );

    expect([inAnEarlierShape.happened, both.happened]).toEqual([
      `The ledger is kept in PostgreSQL, in the database auto_runtime on db.example.com:5432, and holds the fact license_activated at position 1204, in a shape this version of Auto Runtime does not read: it was made by a newer version, or by an earlier version than this one carries forward.`,
      `The ledger is kept in PostgreSQL, in the database auto_runtime on db.example.com:5432, and holds facts of the type metering_faulted, which this version of Auto Runtime does not read, and the facts license_activated at position 1204, connection_added at position 77, in a shape this version of Auto Runtime does not read: it was made by a newer version, or by an earlier version than this one carries forward.`,
    ]);
  });
});

describe('a ledger refused for its facts', () => {
  it('is found, as a ledger of another version is, inside the failure it causes', () => {
    const settings = { ledger: { store: 'sqlite', file: '/data/ledger.db' }, distribution: 'npx' } as const;
    const unknownFacts = ledgerOfUnknownFacts({ unknown: ['metering_faulted'], unreadable: [] }, settings);
    const anEarlierLedger = ledgerOfAnotherVersion({ found: 1, kept: 3, floor: 2 }, settings);

    expect([
      ledgerOfAnotherVersionIn(new Error('The services could not start', { cause: unknownFacts })),
      ledgerOfAnotherVersionIn(anEarlierLedger),
      ledgerOfAnotherVersionIn(new Error('Something else')),
      ledgerOfAnotherVersionIn('not an error'),
    ]).toEqual([unknownFacts, anEarlierLedger, undefined, undefined]);
  });
});

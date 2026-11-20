import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Environment } from '@on.auto/config';
import { statement } from '@on.auto/ledger';
import { afterEach, describe, expect, it } from 'vitest';

import { aLedgerAServerKeptAt, type KeptBySignIn } from '../testing/records/ledger-a-server-kept.ts';
import { readOfTheLedgerIn, rowsOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runAdminCommand } from './run-admin-command.ts';

const ledgers: TemporaryLedger[] = [];

afterEach(() => {
  for (const { remove } of ledgers.splice(0)) {
    remove();
  }
});

function aLedgerFile(): string {
  const ledger = temporaryLedger();
  ledgers.push(ledger);
  return ledger.fileName;
}

interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly errors: readonly string[];
}

async function ran(args: readonly string[], environment: Environment): Promise<Ran> {
  const out: string[] = [];
  const errors: string[] = [];
  const code = await runAdminCommand(args, {
    environment,
    console: {
      log: (line) => {
        out.push(line);
      },
      error: (line) => {
        errors.push(line);
      },
    },
    usage: 'the usage of the test',
  });
  return { code, out, errors };
}

const issuer = 'https://login.example.com/acme';

const ada = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

const session = {
  model: 'Session',
  payload: '{}',
  grantId: undefined,
  uid: 'a-uid',
  expiresAt: Date.now() + 86_400_000,
};

async function tiedWithASession({ setup, providerRows }: KeptBySignIn): Promise<void> {
  await setup.requiredClaimSet({ issuer, claim: 'tenant', value: 'acme', person: ada });
  await providerRows.kept({ ...session, sha256: 'sha256-of-a-session' });
}

function contextsOf(file: string, type: string): Promise<readonly unknown[]> {
  return readOfTheLedgerIn(
    file,
    statement`SELECT json_extract(message_metadata, '$.by') AS by FROM emt_messages WHERE message_type = ${type}`,
  );
}

describe('admin reset-setup', () => {
  it('ends the value in force and signs everyone out, recorded by the command, and when asked again signs out anyone left signed in and records nothing more', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aLedgerAServerKeptAt({ LEDGER_FILE }, tiedWithASession);

    const first = await ran(['reset-setup'], { LEDGER_FILE });
    const sessionsAfterwards = await rowsOfTheLedgerIn(LEDGER_FILE, 'auth_oidc_models');
    await aLedgerAServerKeptAt({ LEDGER_FILE }, ({ providerRows }) =>
      providerRows.kept({ ...session, sha256: 'sha256-of-a-session-left-signed-in' }),
    );
    const again = await ran(['reset-setup'], { LEDGER_FILE });

    expect([first.code, first.out.length, first.errors, sessionsAfterwards]).toEqual([0, 2, [], []]);
    expect([again.code, again.out, again.errors]).toEqual([0, first.out, []]);
    expect(await contextsOf(LEDGER_FILE, 'setup_reopened')).toEqual([{ by: 'command' }]);
    expect(await rowsOfTheLedgerIn(LEDGER_FILE, 'auth_oidc_models')).toEqual([]);
  });

  it('records nothing and opens no ledger where OIDC_REQUIRED_CLAIM gives the value, which the recorded one never decides', async () => {
    const LEDGER_FILE = aLedgerFile();

    const refused = await ran(['reset-setup'], {
      LEDGER_FILE,
      PUBLIC_URL: 'https://auto.example.com',
      OIDC_ISSUER: issuer,
      OIDC_REQUIRED_CLAIM: 'tenant=acme',
    });

    expect([refused.code, refused.out, refused.errors.length, existsSync(LEDGER_FILE)]).toEqual([1, [], 1, false]);
  });

  it('starts over the value the first sign-in recorded where the settings name the claim and no value, as the default identity provider’s do', async () => {
    const environment = { LEDGER_FILE: aLedgerFile(), PUBLIC_URL: 'https://auto.example.com' };
    await aLedgerAServerKeptAt(environment, tiedWithASession);

    const started = await ran(['reset-setup'], environment);

    expect([started.code, started.out.length]).toEqual([0, 2]);
    expect(await rowsOfTheLedgerIn(environment.LEDGER_FILE, 'auth_oidc_models')).toEqual([]);
  });
});

describe('admin reset-setup on a server no sign-in ever tied', () => {
  it('finds nothing to start over, records nothing and says which ledger it read', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aLedgerAServerKeptAt({ LEDGER_FILE }, () => Promise.resolve());

    const untied = await ran(['reset-setup'], { LEDGER_FILE });

    expect([untied.code, untied.out.length, untied.errors]).toEqual([0, 2, []]);
    expect(untied.out[1]).toContain(LEDGER_FILE);
    expect(await contextsOf(LEDGER_FILE, 'setup_reopened')).toEqual([]);
  });
});

const priya = '0c3de111680d66bea9b377080ec7d6784c7602c7bc2e4bfdd1b3ee489b0675ea';

async function twoPeopleSignedIn({ peopleRows, enrolling }: KeptBySignIn): Promise<void> {
  await peopleRows.kept({ person: ada, name: 'Ada Lovelace', emailAddress: 'ada@example.com', updatedAt: 1 });
  await enrolling.enrolled(ada);
  await peopleRows.kept({ person: priya, emailAddress: 'Priya@Example.com', updatedAt: 2 });
  await enrolling.enrolled(priya);
}

function rolesRecordedIn(file: string): Promise<readonly unknown[]> {
  return readOfTheLedgerIn(
    file,
    statement`SELECT message_type AS fact, json_extract(message_data, '$.principal.id') AS person,
        json_extract(message_data, '$.role.id') AS role, json_extract(message_data, '$.source') AS source,
        json_extract(message_metadata, '$.by') AS by
      FROM emt_messages WHERE message_type IN ('role_assigned', 'role_unassigned') ORDER BY global_position`,
  );
}

describe('admin grant-admin', () => {
  it('makes the person who signed in with the address an Admin, by command, whatever its letter case, and nobody else, and finds an Admin one already', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aLedgerAServerKeptAt({ LEDGER_FILE }, twoPeopleSignedIn);

    const made = await ran(['grant-admin', 'priya@example.COM'], { LEDGER_FILE });
    const already = await ran(['grant-admin', 'ada@example.com'], { LEDGER_FILE });

    expect([made.code, made.out.length, made.errors]).toEqual([0, 1, []]);
    expect([already.code, already.out.length, already.errors]).toEqual([0, 1, []]);
    expect(await rolesRecordedIn(LEDGER_FILE)).toEqual([
      { fact: 'role_assigned', person: ada, role: 'admin', source: 'bootstrap', by: `person:${ada}` },
      { fact: 'role_assigned', person: priya, role: 'viewer', source: 'enrolment', by: `person:${priya}` },
      { fact: 'role_unassigned', person: priya, role: 'viewer', source: 'command', by: 'command' },
      { fact: 'role_assigned', person: priya, role: 'admin', source: 'command', by: 'command' },
    ]);
  });

  it('records nothing where no one, or more than one person, signed in with the address, or none is given', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aLedgerAServerKeptAt({ LEDGER_FILE }, async (signIn) => {
      await twoPeopleSignedIn(signIn);
      await signIn.peopleRows.kept({ person: 'a-third', emailAddress: 'ADA@example.com', updatedAt: 3 });
    });
    const before = await rolesRecordedIn(LEDGER_FILE);

    const refusals = [
      await ran(['grant-admin', 'grace@example.com'], { LEDGER_FILE }),
      await ran(['grant-admin', 'ada@example.com'], { LEDGER_FILE }),
      await ran(['grant-admin'], { LEDGER_FILE }),
    ];

    expect(refusals.map(({ code, out, errors }) => [code, out, errors.length])).toEqual([
      [1, [], 2],
      [1, [], 1],
      [1, [], 1],
    ]);
    expect(refusals[0]?.errors[1]).toContain(LEDGER_FILE);
    expect(await rolesRecordedIn(LEDGER_FILE)).toEqual(before);
  });
});

describe('the admin commands', () => {
  it.each<readonly [string, readonly string[]]>([
    ['no verb', []],
    ['a verb they do not have', ['reset-everything']],
    ['a verb given more than it takes', ['reset-setup', 'now']],
  ])('refuse %s with their usage, and open no ledger', async (_case, args) => {
    const LEDGER_FILE = aLedgerFile();

    expect(await ran(args, { LEDGER_FILE })).toEqual({
      code: 1,
      out: [],
      errors: [`auto-runtime has no command "${['admin', ...args].join(' ')}"`, 'the usage of the test'],
    });
    expect(existsSync(LEDGER_FILE)).toBe(false);
  });

  it('refuse settings the server would refuse, in the server’s words, and open no ledger', async () => {
    const LEDGER_FILE = aLedgerFile();

    const refused = await ran(['reset-setup'], { LEDGER_FILE, LOG_FORMAT: 'fancy' });

    expect([refused.code, refused.out, refused.errors.length, existsSync(LEDGER_FILE)]).toEqual([1, [], 1, false]);
  });

  it('run as a process of their own, from the entry the container runs, which answers on standard output and refuses on standard error, and ends once it has', async () => {
    const LEDGER_FILE = aLedgerFile();
    await aLedgerAServerKeptAt({ LEDGER_FILE }, tiedWithASession);
    const asAProcess = (...args: readonly string[]) =>
      spawnSync(process.execPath, [fileURLToPath(new URL('../admin-command.ts', import.meta.url)), ...args], {
        encoding: 'utf8',
        env: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], LEDGER_FILE },
      });

    const [answered, refused] = [asAProcess('reset-setup'), asAProcess()];

    expect([answered.status, answered.stdout.trim().split('\n').length]).toEqual([0, 2]);
    expect([refused.status, refused.stdout, refused.stderr.trim().split('\n').length]).toEqual([1, '', 5]);
    expect(await contextsOf(LEDGER_FILE, 'setup_reopened')).toEqual([{ by: 'command' }]);
  });
});

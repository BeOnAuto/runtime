import { existsSync } from 'node:fs';

import { statement } from '@on.auto/ledger';
import type { ProviderRequests } from '@on.auto/openid-connect';
import { fakeProvider } from '@on.auto/openid-connect/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { aLedgerAServerKeptAt } from '../testing/records/ledger-a-server-kept.ts';
import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runAdminCommand, type AdminHost } from './run-admin-command.ts';

const ledgers: TemporaryLedger[] = [];

afterEach(() => {
  for (const { remove } of ledgers.splice(0)) {
    remove();
  }
});

const issuer = 'https://login.example.com/tenant/v2.0';

const publicUrl = 'https://auto.example.com';

async function aLedgerTheServerMade(): Promise<string> {
  const ledger = temporaryLedger();
  ledgers.push(ledger);
  await aLedgerAServerKeptAt({ LEDGER_FILE: ledger.fileName }, () => Promise.resolve());
  return ledger.fileName;
}

interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly errors: readonly string[];
}

type Given = Pick<AdminHost, 'environment'> & Partial<Pick<AdminHost, 'requests' | 'defaultIdentityProvider'>>;

async function registered(given: Given): Promise<Ran> {
  const out: string[] = [];
  const errors: string[] = [];
  const code = await runAdminCommand(['register-client'], {
    ...given,
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

const decodeRegistrations = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ client: Schema.String, by: Schema.String })),
);

async function registrationsIn(file: string): Promise<ReturnType<typeof decodeRegistrations>> {
  return decodeRegistrations(
    await readOfTheLedgerIn(
      file,
      statement`SELECT json_extract(message_data, '$.client_id') AS client, json_extract(message_metadata, '$.by') AS by
        FROM emt_messages WHERE message_type = 'sign_in_client_registered' ORDER BY global_position`,
    ),
  );
}

interface Meanwhile {
  readonly requests: ProviderRequests;
  readonly elsewhere: () => Promise<Ran | undefined>;
}

function anotherServerRegisteringMeanwhile(environment: AdminHost['environment']): Meanwhile {
  const provider = fakeProvider(issuer);
  const elsewhere: Promise<Ran>[] = [];
  const registeringFirst = async (request: Readonly<Request>) => {
    const isTheRegistration = new URL(request.url).pathname.endsWith('/register');
    elsewhere.push(
      ...(isTheRegistration && elsewhere.length === 0
        ? [registered({ environment, requests: provider.requests })]
        : []),
    );
    await elsewhere[0];
  };
  return {
    requests: {
      fetch: async (request) => {
        await registeringFirst(request);
        return provider.requests.fetch(request);
      },
    },
    elsewhere: () => Promise.resolve(elsewhere[0]),
  };
}

describe('admin register-client', () => {
  it('registers the server with the provider OIDC_ISSUER names, and again in place of the client in use, each recorded by the command', async () => {
    const LEDGER_FILE = await aLedgerTheServerMade();
    const provider = fakeProvider(issuer);
    const environment = { LEDGER_FILE, PUBLIC_URL: publicUrl, OIDC_ISSUER: issuer };

    const first = await registered({ environment, requests: provider.requests });
    const again = await registered({ environment, requests: provider.requests });
    const [one, other] = await registrationsIn(LEDGER_FILE);

    expect([first.code, first.out.length, again.code, again.out.length]).toEqual([0, 1, 0, 1]);
    expect([one?.by, other?.by, provider.registrationsAsked().length]).toEqual(['command', 'command', 2]);
    expect(other?.client).not.toBe(one?.client);
    expect(again.out[0]).toContain(String(one?.client));
    expect(again.out[0]).toContain(String(other?.client));
  });

  it('registers by the address of the server where people sign in at the default identity provider', async () => {
    const LEDGER_FILE = await aLedgerTheServerMade();
    const provider = fakeProvider(issuer);

    const { code } = await registered({
      environment: { LEDGER_FILE, PUBLIC_URL: publicUrl },
      requests: provider.requests,
      defaultIdentityProvider: { issuer, scopes: ['openid', 'profile', 'email'], requiredClaim: { claim: 'tenant' } },
    });

    expect([code, provider.registrationsAsked()[0]?.['client_uri']]).toEqual([0, publicUrl]);
  });

  it('keeps the client another server of the database registered at the same moment, and records nothing of its own', async () => {
    const LEDGER_FILE = await aLedgerTheServerMade();
    const environment = { LEDGER_FILE, PUBLIC_URL: publicUrl, OIDC_ISSUER: issuer };
    const meanwhile = anotherServerRegisteringMeanwhile(environment);

    const racing = await registered({ environment, requests: meanwhile.requests });
    const [kept, ...more] = await registrationsIn(LEDGER_FILE);

    expect([racing.code, racing.out.length, (await meanwhile.elsewhere())?.code, more]).toEqual([0, 1, 0, []]);
    expect(racing.out[0]).toContain(String(kept?.client));
  });
});

describe('admin register-client, where it cannot register', () => {
  it('opens no ledger where OIDC_CLIENT_ID gives the client, or no one signs in', async () => {
    const LEDGER_FILE = `${await aLedgerTheServerMade()}-never-made`;
    const given = { OIDC_CLIENT_ID: 'auto-runtime', OIDC_CLIENT_SECRET: 'a-client-secret-of-the-test' };

    const refusals = [
      await registered({ environment: { LEDGER_FILE, PUBLIC_URL: publicUrl, OIDC_ISSUER: issuer, ...given } }),
      await registered({ environment: { LEDGER_FILE } }),
    ];

    expect(refusals.map(({ code, out, errors }) => [code, out, errors.length])).toEqual([
      [1, [], 1],
      [1, [], 1],
    ]);
    expect(existsSync(LEDGER_FILE)).toBe(false);
  });

  it('records nothing where the provider refuses to register the server, or cannot be reached', async () => {
    const LEDGER_FILE = await aLedgerTheServerMade();
    const environment = { LEDGER_FILE, PUBLIC_URL: publicUrl, OIDC_ISSUER: issuer };
    const unreachable: ProviderRequests = { fetch: () => Promise.reject(new TypeError('fetch failed')) };

    const refusals = [
      await registered({
        environment,
        requests: fakeProvider(issuer, { registrationError: 'access_denied' }).requests,
      }),
      await registered({ environment, requests: unreachable }),
    ];

    expect(refusals.map(({ code, out, errors }) => [code, out, errors.length])).toEqual([
      [1, [], 1],
      [1, [], 1],
    ]);
    expect(await registrationsIn(LEDGER_FILE)).toEqual([]);
  });
});

describe('admin register-client, where people sign in at the default identity provider and it cannot register', () => {
  it('records nothing and names no setting, since that server takes none that could change it', async () => {
    const LEDGER_FILE = await aLedgerTheServerMade();

    const refusal = await registered({
      environment: { LEDGER_FILE, PUBLIC_URL: publicUrl },
      requests: fakeProvider(issuer, { registrationError: 'access_denied' }).requests,
      defaultIdentityProvider: { issuer, scopes: ['openid', 'profile', 'email'], requiredClaim: { claim: 'tenant' } },
    });

    expect([refusal.code, refusal.out, refusal.errors.length]).toEqual([1, [], 1]);
    expect(refusal.errors[0]?.match(/\b[A-Z]+_[A-Z_]+\b/gu)).toBeNull();
    expect(await registrationsIn(LEDGER_FILE)).toEqual([]);
  });
});

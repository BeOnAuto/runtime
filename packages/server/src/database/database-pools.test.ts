import type { Environment } from '@on.auto/config';
import type { ProxySettings } from '@on.auto/outbound';
import type { DatabaseTokenRequest } from '@on.auto/outbound/aws';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { PostgreSQLLedgerSettings } from '../settings/ledger-settings.ts';
import { aFakePostgreSQL } from '../testing/databases/fake-postgresql.ts';
import { aCertificateOfTheLoopback, trustedForTheTest } from '../testing/databases/loopback-certificate.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { databasePoolsOf, type DatabaseTokenSignerOf } from './database-pools.ts';

interface Asked {
  readonly proxy: ProxySettings;
  readonly request: DatabaseTokenRequest;
}

interface RecordingSigner {
  readonly signerOf: DatabaseTokenSignerOf;
  readonly asked: () => readonly Asked[];
  readonly signed: () => readonly string[];
}

function aRecordingSigner(): RecordingSigner {
  const asked: Asked[] = [];
  const signed: string[] = [];
  return {
    signerOf: (proxy, request) => {
      asked.push({ proxy, request });
      return () => {
        signed.push(`token-${signed.length + 1}`);
        return Promise.resolve(signed.at(-1) ?? '');
      };
    },
    asked: () => asked,
    signed: () => signed,
  };
}

const proxied = { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://proxy.internal:3128' };

function postgresqlLedgerOf(environment: Environment): PostgreSQLLedgerSettings {
  const { ledger } = readSettingsOf({ SECRETS_KEY: secretsKey, ...environment });
  if (ledger.store === 'sqlite') {
    throw new Error('Expected a ledger in PostgreSQL');
  }
  return ledger;
}

function signingLedgerOn(port: number): PostgreSQLLedgerSettings {
  return postgresqlLedgerOf({
    DATABASE_URL: `postgresql://auto_runtime@127.0.0.1:${port}/playbooks`,
    DATABASE_CREDENTIALS: 'aws-iam',
    AWS_REGION: 'eu-west-1',
  });
}

describe('the pools of a ledger whose password is in DATABASE_URL', () => {
  it('open plain pools on the URL, with as many connections as each is asked for, and sign nothing', () => {
    const url = 'postgresql://auto_runtime:a-password@db.example.com:5432/playbooks';
    const signer = aRecordingSigner();

    const pool = databasePoolsOf(
      postgresqlLedgerOf({ DATABASE_URL: url }),
      readSettingsOf({}).proxy,
      signer.signerOf,
    )({
      max: 4,
    });
    onTestFinished(() => pool.end());

    expect(pool.options).toMatchObject({ connectionString: url, max: 4 });
    expect(signer.asked()).toEqual([]);
  });
});

describe('the pools of a ledger that signs a token for each connection', () => {
  it('ask for a token for every connection they open, signed for the host, the port, the user and the region', async () => {
    const certificate = aCertificateOfTheLoopback();
    trustedForTheTest(certificate);
    const database = await aFakePostgreSQL(certificate);
    const signer = aRecordingSigner();
    const { proxy } = readSettingsOf(proxied);

    const pool = databasePoolsOf(signingLedgerOn(database.port), proxy, signer.signerOf)({ max: 2 });
    onTestFinished(() => pool.end());
    const connections = await Promise.all([pool.connect(), pool.connect()]);
    for (const connection of connections) {
      connection.release();
    }

    expect(signer.asked()).toEqual([
      { proxy, request: { hostname: '127.0.0.1', port: database.port, username: 'auto_runtime', region: 'eu-west-1' } },
    ]);
    expect(signer.signed()).toEqual(['token-1', 'token-2']);
    expect(database.passwords()).toEqual(['token-1', 'token-2']);
  });

  it('reach only a database whose certificate they verify, and ask no token of one they cannot', async () => {
    const database = await aFakePostgreSQL(aCertificateOfTheLoopback());
    const signer = aRecordingSigner();
    const pool = databasePoolsOf(signingLedgerOn(database.port), readSettingsOf({}).proxy, signer.signerOf)({ max: 1 });
    onTestFinished(() => pool.end());

    await expect(pool.connect()).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    expect(signer.signed()).toEqual([]);
    expect(database.passwords()).toEqual([]);
  });

  it('refuse a database that offers no TLS, before any token is asked for', async () => {
    const database = await aFakePostgreSQL();
    const signer = aRecordingSigner();
    const pool = databasePoolsOf(signingLedgerOn(database.port), readSettingsOf({}).proxy, signer.signerOf)({ max: 1 });
    onTestFinished(() => pool.end());

    await expect(pool.connect()).rejects.toThrow('The server does not support SSL connections');
    expect(database.askedForTls()).toBe(1);
    expect(signer.signed()).toEqual([]);
  });
});

describe('the host name of a database that signs in with tokens', () => {
  it('is checked against its certificate, which names another address, before any token is asked for', async () => {
    const certificate = aCertificateOfTheLoopback('127.0.0.2');
    trustedForTheTest(certificate);
    const database = await aFakePostgreSQL(certificate);
    const signer = aRecordingSigner();
    const pool = databasePoolsOf(signingLedgerOn(database.port), readSettingsOf({}).proxy, signer.signerOf)({ max: 1 });
    onTestFinished(() => pool.end());

    await expect(pool.connect()).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expect(signer.signed()).toEqual([]);
    expect(database.passwords()).toEqual([]);
  });
});

describe('a token the pools of a ledger cannot sign', () => {
  it('fails the connection that asked for it with the error of the credential chain', async () => {
    const certificate = aCertificateOfTheLoopback();
    trustedForTheTest(certificate);
    const database = await aFakePostgreSQL(certificate);
    const unsigned = new Error('Could not load credentials from any providers');
    const pool = databasePoolsOf(
      signingLedgerOn(database.port),
      readSettingsOf({}).proxy,
      () => () => Promise.reject(unsigned),
    )({ max: 1 });
    onTestFinished(() => pool.end());

    await expect(pool.connect()).rejects.toBe(unsigned);
    expect(database.passwords()).toEqual([]);
  });
});

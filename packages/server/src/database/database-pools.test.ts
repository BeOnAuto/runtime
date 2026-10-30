import type { ProxySettings } from '@on.auto/outbound';
import type { DatabaseTokenRequest } from '@on.auto/outbound/aws';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type { PostgreSQLLedgerSettings } from '../settings/ledger-settings.ts';
import { aFakePostgreSQL } from '../testing/databases/fake-postgresql.ts';
import { aCertificateOfTheLoopback, trustedForTheTest } from '../testing/databases/loopback-certificate.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import {
  modulesOfTheSignerLoaded,
  modulesOfTheSignerLoadedInAProcessOfItsOwnBy,
} from '../testing/databases/signer-modules.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { databasePoolsOf, signerLoadedWithTheFirstTokenBy, type DatabaseTokenSignerOf } from './database-pools.ts';

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

function postgresqlLedgerOf(environment: Readonly<Record<string, string>>): PostgreSQLLedgerSettings {
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

  it('load no module of the signer of the tokens, which a password does not need, in a process of their own', async () => {
    const loaded = await modulesOfTheSignerLoadedInAProcessOfItsOwnBy({
      DATABASE_URL: 'postgresql://auto_runtime:a-password@db.example.com:5432/playbooks',
    });

    expect(loaded).toEqual([]);
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

describe('the pools of a ledger that signs a token for each connection with the signer of the server', () => {
  it('load no module of the signer until they ask for a token, in a process of their own', async () => {
    const loaded = await modulesOfTheSignerLoadedInAProcessOfItsOwnBy({
      DATABASE_URL: 'postgresql://auto_runtime@127.0.0.1:5432/playbooks',
      DATABASE_CREDENTIALS: 'aws-iam',
      AWS_REGION: 'eu-west-1',
    });

    expect(loaded).toEqual([]);
  });

  it('load the signer with the first token they ask for, and sign in with the token it signs', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key-of-the-tests');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key-of-the-tests');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const certificate = aCertificateOfTheLoopback();
    trustedForTheTest(certificate);
    const database = await aFakePostgreSQL(certificate);
    const pool = databasePoolsOf(signingLedgerOn(database.port), readSettingsOf({}).proxy)({ max: 1 });
    onTestFinished(() => pool.end());

    (await pool.connect()).release();

    expect(modulesOfTheSignerLoaded()).toContainEqual(expect.stringContaining('/@aws-sdk/rds-signer/dist-cjs/'));
    expect(database.passwords()).toEqual([
      expect.stringMatching(
        new RegExp(
          `^127\\.0\\.0\\.1:${database.port}/\\?Action=connect&DBUser=auto_runtime&X-Amz-Algorithm=AWS4-HMAC-SHA256&`,
          'u',
        ),
      ),
    ]);
  });
});

describe('a signer of the tokens that cannot be loaded', () => {
  it('fails each connection that asks for a token, naming the setting that needs it and the failure of the load', async () => {
    const certificate = aCertificateOfTheLoopback();
    trustedForTheTest(certificate);
    const database = await aFakePostgreSQL(certificate);
    const unloadable = new Error("Cannot find package '@aws-sdk/rds-signer'");
    const pool = databasePoolsOf(
      signingLedgerOn(database.port),
      readSettingsOf({}).proxy,
      signerLoadedWithTheFirstTokenBy(() => Promise.reject(unloadable)),
    )({ max: 1 });
    onTestFinished(() => pool.end());
    const notLoaded = {
      _tag: 'TokenSignerNotLoadedError',
      message:
        "With DATABASE_CREDENTIALS=aws-iam each connection signs in with a token, and the signer of the tokens could not be loaded: Error: Cannot find package '@aws-sdk/rds-signer'",
      cause: unloadable,
    };

    await expect(pool.connect()).rejects.toMatchObject(notLoaded);
    await expect(pool.connect()).rejects.toMatchObject(notLoaded);
    expect(database.passwords()).toEqual([]);
  });
});

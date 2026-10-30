import { plainPoolsOn, type PostgreSQLPools } from '@on.auto/ledger/postgresql';
import type { ProxySettings } from '@on.auto/outbound';
import type { DatabaseTokenRequest, DatabaseTokenSigner } from '@on.auto/outbound/aws';
import { Data, Redacted } from 'effect';
import { Pool } from 'pg';

import type { PostgreSQLLedgerSettings } from '../settings/ledger-settings.ts';

export type DatabaseTokenSignerOf = (proxy: ProxySettings, request: DatabaseTokenRequest) => DatabaseTokenSigner;

export type DatabaseTokenSignerLoader = () => Promise<{ readonly awsDatabaseTokenSigner: DatabaseTokenSignerOf }>;

class TokenSignerNotLoadedError extends Data.TaggedError('TokenSignerNotLoadedError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

async function signerOfTheTokensLoadedBy(load: DatabaseTokenSignerLoader): Promise<DatabaseTokenSignerOf> {
  try {
    const { awsDatabaseTokenSigner } = await load();
    return awsDatabaseTokenSigner;
  } catch (failure) {
    throw new TokenSignerNotLoadedError({
      message: `With DATABASE_CREDENTIALS=aws-iam each connection signs in with a token, and the signer of the tokens could not be loaded: ${String(failure)}`,
      cause: failure,
    });
  }
}

async function signerFor(
  load: DatabaseTokenSignerLoader,
  proxy: ProxySettings,
  request: DatabaseTokenRequest,
): Promise<DatabaseTokenSigner> {
  const signerOf = await signerOfTheTokensLoadedBy(load);
  return signerOf(proxy, request);
}

export function signerLoadedWithTheFirstTokenBy(load: DatabaseTokenSignerLoader): DatabaseTokenSignerOf {
  return (proxy, request) => {
    const loaded: { signer?: Promise<DatabaseTokenSigner> } = {};
    return async () => {
      loaded.signer ??= signerFor(load, proxy, request);
      const sign = await loaded.signer;
      return sign();
    };
  };
}

const signerOfTheServer = signerLoadedWithTheFirstTokenBy(() => import('@on.auto/outbound/aws'));

export function databasePoolsOf(
  ledger: PostgreSQLLedgerSettings,
  proxy: ProxySettings,
  signerOf: DatabaseTokenSignerOf = signerOfTheServer,
): PostgreSQLPools {
  const { credentials, database } = ledger;
  if (credentials.kind === 'url') {
    return plainPoolsOn(Redacted.value(ledger.url));
  }
  const { hostname, port, username } = credentials.signedFor;
  const signedToken = signerOf(proxy, credentials.signedFor);
  return ({ max }) =>
    new Pool({ host: hostname, port, user: username, database, ssl: true, password: signedToken, max });
}

import type { DatabaseTokenRequest } from '@on.auto/outbound/aws';
import { Effect } from 'effect';

export type DatabaseCredentials =
  | { readonly kind: 'url' }
  | { readonly kind: 'aws-iam'; readonly signedFor: DatabaseTokenRequest };

export type CredentialsKind = DatabaseCredentials['kind'];

const kinds: ReadonlySet<string> = new Set(['url', 'aws-iam']);

const postgresqlPort = 5432;

const regionOfAnRdsHost = /\.([a-z]{2}(?:-[a-z]+)+-\d+)\.rds\.amazonaws\.com$/u;

const withSignedTokens = 'With DATABASE_CREDENTIALS=aws-iam';

function isCredentialsKind(value: string): value is CredentialsKind {
  return kinds.has(value);
}

export function credentialsKindOf(given = 'url'): Effect.Effect<CredentialsKind, string> {
  return isCredentialsKind(given)
    ? Effect.succeed(given)
    : Effect.fail('DATABASE_CREDENTIALS: Expected url, the password in DATABASE_URL, or aws-iam');
}

function userOf(url: Readonly<URL>): string {
  try {
    return decodeURIComponent(url.username);
  } catch {
    return '';
  }
}

function refusalOf(url: Readonly<URL>): string | undefined {
  const options = [...new Set(url.searchParams.keys())];
  if (url.password !== '' || options.includes('password')) {
    return `DATABASE_URL: ${withSignedTokens} the password is a token signed for each connection, so the URL holds none`;
  }
  if (userOf(url) === '') {
    return `DATABASE_URL: ${withSignedTokens} the URL names the user the token is signed for, such as postgresql://user@host:5432/database`;
  }
  if (url.searchParams.getAll('sslmode').some((mode) => mode !== 'verify-full')) {
    return `DATABASE_URL: ${withSignedTokens} the connection verifies the database's certificate and host name, so sslmode is verify-full or left out`;
  }
  const tlsOptions = options.filter((option) => option.startsWith('ssl') && option !== 'sslmode');
  if (tlsOptions.length > 0) {
    return `DATABASE_URL: ${withSignedTokens} the connection checks the database's certificate against the certificate authorities Node trusts, so the URL takes no ${tlsOptions.join(', ')}; name the file of your authority's certificate in NODE_EXTRA_CA_CERTS instead`;
  }
  const others = options.filter((option) => !option.startsWith('ssl'));
  return others.length === 0
    ? undefined
    : `DATABASE_URL: ${withSignedTokens} the connection is made from the user, host, port and database of the URL alone, so it takes no ${others.join(', ')}`;
}

function signedFor(url: Readonly<URL>, configuredRegion?: string): Effect.Effect<DatabaseTokenRequest, string> {
  const hostname = url.hostname.replace(/^\[(.+)\]$/u, '$1');
  const region = regionOfAnRdsHost.exec(hostname)?.[1] ?? configuredRegion;
  return region === undefined
    ? Effect.fail(
        `AWS_REGION: ${withSignedTokens} the token is signed for the database's region, which the host of DATABASE_URL does not name, so set AWS_REGION`,
      )
    : Effect.succeed({
        hostname,
        port: url.port === '' ? postgresqlPort : Number(url.port),
        username: userOf(url),
        region,
      });
}

export function credentialsOf(
  kind: CredentialsKind,
  url: Readonly<URL>,
  configuredRegion?: string,
): Effect.Effect<DatabaseCredentials, string> {
  if (kind === 'url') {
    return Effect.succeed({ kind });
  }
  const refusal = refusalOf(url);
  return refusal === undefined
    ? Effect.map(signedFor(url, configuredRegion), (request) => ({ kind, signedFor: request }))
    : Effect.fail(refusal);
}

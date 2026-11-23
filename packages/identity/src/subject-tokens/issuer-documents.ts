import { calculateJwkThumbprint } from 'jose';

export type SubjectTokenAlgorithm = 'RS256' | 'ES256';

export interface RsaSigningKey {
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly d: string;
  readonly p: string;
  readonly q: string;
  readonly dp: string;
  readonly dq: string;
  readonly qi: string;
}

export interface EcSigningKey {
  readonly kty: 'EC';
  readonly crv: 'P-256';
  readonly x: string;
  readonly y: string;
  readonly d: string;
}

export type IssuerSigningKey =
  | { readonly alg: 'RS256'; readonly jwk: RsaSigningKey }
  | { readonly alg: 'ES256'; readonly jwk: EcSigningKey };

interface RsaPublicMembers {
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
}

interface EcPublicMembers {
  readonly kty: 'EC';
  readonly crv: 'P-256';
  readonly x: string;
  readonly y: string;
}

export type PublicJwk = (RsaPublicMembers | EcPublicMembers) & {
  readonly kid: string;
  readonly alg: SubjectTokenAlgorithm;
  readonly use: 'sig';
};

export interface JwkSet {
  readonly keys: readonly PublicJwk[];
}

export interface IssuerMetadata {
  readonly issuer: string;
  readonly jwks_uri: string;
  readonly response_types_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly SubjectTokenAlgorithm[];
  readonly claims_supported: readonly string[];
}

export const issuerMetadataPath = '/.well-known/openid-configuration';

export const jwkSetPath = '/.well-known/jwks.json';

export const mostPublishedKeys = 8;

const subjectTokenClaimNames: readonly string[] = ['iss', 'sub', 'aud', 'iat', 'exp'];

function publicMembersOf({ jwk }: IssuerSigningKey): RsaPublicMembers | EcPublicMembers {
  return jwk.kty === 'RSA' ? { kty: jwk.kty, n: jwk.n, e: jwk.e } : { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function publicJwkOf(key: IssuerSigningKey): Promise<PublicJwk> {
  const members = publicMembersOf(key);
  return { ...members, kid: await calculateJwkThumbprint(members), alg: key.alg, use: 'sig' };
}

export function jwkSetOf(keys: readonly PublicJwk[], most = mostPublishedKeys): JwkSet {
  return { keys: keys.slice(0, most) };
}

export function issuerMetadataOf(issuer: string, algorithm: SubjectTokenAlgorithm): IssuerMetadata {
  return {
    issuer,
    jwks_uri: `${issuer}${jwkSetPath}`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [algorithm],
    claims_supported: subjectTokenClaimNames,
  };
}

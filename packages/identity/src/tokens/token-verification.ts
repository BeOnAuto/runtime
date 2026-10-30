import {
  allPermissions,
  bytesOfReference,
  forbiddenCharactersInWords,
  holdsNoForbiddenCharacter,
  mostReferenceBytes,
  type Permission,
} from '@on.auto/operations';
import { Predicate, Result, Schema } from 'effect';
import { decodeJwt, errors, jwtVerify, type JWTVerifyGetKey, type JWTVerifyOptions } from 'jose';

import { CredentialOrgSchema } from '../access/local-org.ts';
import type { VerifiedPerson } from '../access/principal.ts';
import { UnreadAnswer } from '../identity-service/issuer-requests.ts';

export const mostTokenBytes = 8192;

const scopeClaim = 'scope';

const pageClaim = 'azp';

const nameClaim = 'name';

const leewaySeconds = 60;

const accessTokenTypes: ReadonlySet<string> = new Set(['at+jwt', 'application/at+jwt', 'jwt', 'application/jwt']);

const signingAlgorithms = ['RS256', 'PS256', 'ES256', 'EdDSA'];

const isCredentialOrg = Schema.is(CredentialOrgSchema);

type Payload = Readonly<Record<string, unknown>>;

type Form = 'access token' | 'session';

type ClaimPath = readonly [string, ...string[]];

const orgClaimPaths: Readonly<Record<Form, ClaimPath>> = {
  'access token': ['org_id'],
  session: ['o', 'id'],
};

const subjectAsOrg: ClaimPath = ['sub'];

function namesNoOrg(payload: Payload): boolean {
  return Object.values(orgClaimPaths).every(([claim]) => !Predicate.hasProperty(payload, claim));
}

function orgClaimPathOf(payload: Payload, form: Form): ClaimPath {
  return namesNoOrg(payload) ? subjectAsOrg : orgClaimPaths[form];
}

function orgIn(payload: Payload, path: ClaimPath): unknown {
  return path.reduce<unknown>(
    (claims, claim) => (Predicate.hasProperty(claims, claim) ? claims[claim] : undefined),
    payload,
  );
}

export interface Expected {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly pageOrigins: readonly string[];
  readonly requestOrigin: string | undefined;
  readonly now: number;
}

const presentedByAnotherPage = 'the session was not presented by the page it was issued to';

function onItsClaim(code: string, claim: string): string {
  return `${code} on its ${claim} claim`;
}

function refusalOf(error: unknown): string {
  if (error instanceof errors.JOSEError) {
    return Predicate.hasProperty(error, 'claim') && Predicate.isString(error.claim)
      ? onItsClaim(error.code, error.claim)
      : error.code;
  }
  return error instanceof UnreadAnswer ? 'the key set of its issuer could not be read' : 'it could not be verified';
}

function formOf(token: string): Form {
  const claims = Result.try(() => decodeJwt(token));
  return Result.isSuccess(claims) && claims.success.aud === undefined ? 'session' : 'access token';
}

function optionsOf({ issuer, audiences, now }: Expected, form: Form): JWTVerifyOptions {
  return {
    issuer,
    ...(form === 'access token' ? { audience: [...audiences] } : {}),
    algorithms: signingAlgorithms,
    clockTolerance: leewaySeconds,
    requiredClaims: form === 'session' ? ['exp', 'sub', nameClaim] : ['exp', 'sub'],
    currentDate: new Date(now),
  };
}

function orgClaimRefusal(payload: Payload, form: Form): string | undefined {
  const [claim] = orgClaimPaths[form];
  return namesNoOrg(payload) || Predicate.hasProperty(payload, claim)
    ? undefined
    : onItsClaim(errors.JWTClaimValidationFailed.code, claim);
}

function typeRefusal(typ: unknown): string | undefined {
  return typ === undefined || (Predicate.isString(typ) && accessTokenTypes.has(typ.toLowerCase()))
    ? undefined
    : 'its typ is not that of an access token';
}

function pageRefusal({ [pageClaim]: page }: Payload, form: Form, expected: Expected): string | undefined {
  if (form === 'access token') {
    return undefined;
  }
  if (!Predicate.isString(page) || !expected.pageOrigins.includes(page)) {
    return onItsClaim(errors.JWTClaimValidationFailed.code, pageClaim);
  }
  return page === expected.requestOrigin ? undefined : presentedByAnotherPage;
}

function isNamingClaim(claim: unknown): claim is string {
  return (
    Predicate.isString(claim) &&
    claim !== '' &&
    bytesOfReference(claim) <= mostReferenceBytes &&
    holdsNoForbiddenCharacter(claim)
  );
}

function notNaming(claim: string): string {
  return `its ${claim} is not a non-empty string of at most ${mostReferenceBytes} bytes without ${forbiddenCharactersInWords}`;
}

function permissionsGrantedBy({ [scopeClaim]: scope = '' }: Payload, form: Form): string | readonly Permission[] {
  if (form === 'session') {
    return allPermissions;
  }
  if (!Predicate.isString(scope)) {
    return `its ${scopeClaim} claim is not a string of scopes separated by spaces`;
  }
  const granted = new Set(scope.split(' '));
  return allPermissions.filter((permission) => granted.has(permission));
}

function personIn(payload: Payload, form: Form, now: number): string | VerifiedPerson {
  const { iat, sub, [nameClaim]: given } = payload;
  const name = given === undefined ? sub : given;
  const orgClaimPath = orgClaimPathOf(payload, form);
  const org = orgIn(payload, orgClaimPath);
  if (Predicate.isNumber(iat) && iat > now / 1000 + leewaySeconds) {
    return `its iat is more than ${leewaySeconds} seconds ahead`;
  }
  if (!isNamingClaim(sub)) {
    return notNaming('sub');
  }
  if (!isNamingClaim(name)) {
    return notNaming(nameClaim);
  }
  if (!isCredentialOrg(org)) {
    return `its ${orgClaimPath.join('.')} claim is not an org id other than local`;
  }
  const permissions = permissionsGrantedBy(payload, form);
  return Predicate.isString(permissions) ? permissions : { subject: sub, name, org, permissions };
}

async function verified(token: string, keySet: JWTVerifyGetKey, expected: Expected): Promise<string | VerifiedPerson> {
  const form = formOf(token);
  const { payload, protectedHeader } = await jwtVerify(token, keySet, optionsOf(expected, form));
  return (
    orgClaimRefusal(payload, form) ??
    typeRefusal(protectedHeader.typ) ??
    pageRefusal(payload, form, expected) ??
    personIn(payload, form, expected.now)
  );
}

export async function verifiedPerson(
  token: string,
  keySet: JWTVerifyGetKey,
  expected: Expected,
): Promise<Result.Result<VerifiedPerson, string>> {
  if (token.length > mostTokenBytes) {
    return Result.fail(`it is longer than ${mostTokenBytes / 1024} KiB`);
  }
  try {
    const person = await verified(token, keySet, expected);
    return typeof person === 'string' ? Result.fail(person) : Result.succeed(person);
  } catch (error) {
    return Result.fail(refusalOf(error));
  }
}

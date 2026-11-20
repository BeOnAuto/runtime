import { Redacted, Result } from 'effect';
import { decodeProtectedHeader, errors, jwtVerify } from 'jose';

import { refusalAmong, valueAfter, type DeclaredProof, type ProofCase, type ProofCheck } from './proof-parts.ts';
import { webhookToleranceSeconds } from './standard-webhooks.ts';

type Algorithm = NonNullable<DeclaredProof['alg']>;

const utf8 = new TextEncoder();

function isSignedWith(token: string, alg: Algorithm): boolean {
  const header = Result.try(() => decodeProtectedHeader(token));
  return Result.isSuccess(header) && header.success.alg === alg;
}

function isOutsideItsTimes(error: unknown): boolean {
  return (
    error instanceof errors.JWTExpired ||
    (error instanceof errors.JWTClaimValidationFailed && error.reason === 'check_failed')
  );
}

function refusalOf(error: unknown): ProofCheck {
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return 'mismatched';
  }
  return isOutsideItsTimes(error) ? 'stale' : 'unsigned';
}

async function checkUnder(
  token: string,
  alg: Algorithm,
  secret: Redacted.Redacted,
  nowMs: number,
): Promise<ProofCheck> {
  try {
    await jwtVerify(token, utf8.encode(Redacted.value(secret)), {
      algorithms: [alg],
      currentDate: new Date(nowMs),
      clockTolerance: webhookToleranceSeconds,
    });
    return 'proven';
  } catch (error) {
    return refusalOf(error);
  }
}

export async function jwtCheckOf({ declared, presented, secrets, nowMs }: ProofCase): Promise<ProofCheck> {
  const token = valueAfter(declared.prefix, presented.token);
  const { alg } = declared;
  if (token === undefined || alg === undefined || !isSignedWith(token, alg)) {
    return 'unsigned';
  }
  const checks = await Promise.all(secrets.map((secret) => checkUnder(token, alg, secret, nowMs)));
  return checks.includes('proven') ? 'proven' : refusalAmong(checks);
}

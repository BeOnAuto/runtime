import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { sha256Of } from '@on.auto/content';
import { Redacted } from 'effect';

import { hmacCheckOf } from './hmac-signatures.ts';
import { jwtCheckOf } from './json-web-tokens.ts';
import {
  valueAfter,
  type DeclaredProof,
  type PresentedProof,
  type ProofCase,
  type ProofCheck,
  type Received,
} from './proof-parts.ts';
import { isSignedByAnyOf, presentedWebhookOf, signingKeyOf, type SigningKey } from './standard-webhooks.ts';

type Check = (proof: ProofCase) => ProofCheck | Promise<ProofCheck>;

function digestOf(text: string): Buffer {
  return Buffer.from(sha256Of(text), 'hex');
}

function bearerCheckOf({ declared, presented, secrets }: ProofCase): ProofCheck {
  const token = valueAfter(declared.prefix, presented.token);
  if (token === undefined) {
    return 'unsigned';
  }
  const digest = digestOf(token);
  return secrets.some((secret) => timingSafeEqual(digestOf(Redacted.value(secret)), digest)) ? 'proven' : 'mismatched';
}

function signingKeysOf(secrets: readonly Redacted.Redacted[]): readonly SigningKey[] {
  return secrets.flatMap((secret) => {
    const key = signingKeyOf(Redacted.value(secret));
    return key === undefined ? [] : [key];
  });
}

function standardWebhookCheckOf({ presented, secrets, body, nowMs }: ProofCase): ProofCheck {
  const webhook = presented.header === undefined ? 'unsigned' : presentedWebhookOf(presented.header, nowMs);
  if (typeof webhook === 'string') {
    return webhook;
  }
  return isSignedByAnyOf(signingKeysOf(secrets), webhook, body) ? 'proven' : 'mismatched';
}

const checkOfEachScheme: Readonly<Record<DeclaredProof['scheme'], Check>> = {
  hmac: hmacCheckOf,
  'standard-webhooks': standardWebhookCheckOf,
  bearer: bearerCheckOf,
  jwt: jwtCheckOf,
};

function holdsSomething(secret: Redacted.Redacted): boolean {
  return Redacted.value(secret).length > 0;
}

export function checkedProof(
  declared: DeclaredProof,
  presented: PresentedProof,
  secrets: readonly Redacted.Redacted[],
  received: Received,
): Promise<ProofCheck> {
  const check = checkOfEachScheme[declared.scheme];
  return Promise.resolve(
    check({ declared, presented, secrets: secrets.filter((secret) => holdsSomething(secret)), ...received }),
  );
}

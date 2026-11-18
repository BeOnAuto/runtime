import type { Redacted } from 'effect';

import type { HeaderOf, WebhookRefusal } from './standard-webhooks.ts';

export interface DeclaredProof {
  readonly scheme: 'hmac' | 'standard-webhooks' | 'bearer' | 'jwt';
  readonly hash?: 'sha256' | 'sha384' | 'sha512';
  readonly signed_payload?: string;
  readonly prefix?: string;
  readonly encoding?: 'hex' | 'base64';
  readonly alg?: 'HS256' | 'HS384' | 'HS512';
}

export interface PresentedProof {
  readonly signature?: string;
  readonly timestamp?: string | number;
  readonly id?: string;
  readonly token?: string;
  readonly header?: HeaderOf;
}

export interface Received {
  readonly body: Readonly<Uint8Array>;
  readonly nowMs: number;
}

export type ProofCheck = 'proven' | WebhookRefusal | 'mismatched';

export interface ProofCase extends Received {
  readonly declared: DeclaredProof;
  readonly presented: PresentedProof;
  readonly secrets: readonly Redacted.Redacted[];
}

export function valueAfter(prefix: string | undefined, presented: string | undefined): string | undefined {
  const before = prefix ?? '';
  return presented?.startsWith(before) === true && presented.length > before.length
    ? presented.slice(before.length)
    : undefined;
}

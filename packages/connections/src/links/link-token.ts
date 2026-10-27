import { randomBytes } from 'node:crypto';

import { sha256Of } from '@on.auto/operations';
import { DateTime, Duration, Effect } from 'effect';

import type { OpenLink } from '../registry/registry.ts';

const tokenBytes = 32;

const tenMinutes = Duration.minutes(10);

export interface IssuedLink extends OpenLink {
  readonly token: string;
}

export function tokenSha256Of(token: string): string {
  return sha256Of(token);
}

export function isTheLinkOf({ token_sha256: tokenSha256 }: OpenLink, page: string): boolean {
  return tokenSha256 === tokenSha256Of(String(new URL(page).searchParams.get('token')));
}

export const tenMinutesOn: Effect.Effect<string> = Effect.gen(function* () {
  return DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, tenMinutes));
});

export function issuedToken(): { readonly token: string; readonly token_sha256: string } {
  const token = randomBytes(tokenBytes).toString('base64url');
  return { token, token_sha256: tokenSha256Of(token) };
}

export const issuedLink: Effect.Effect<IssuedLink> = Effect.map(tenMinutesOn, (expiresAt) => ({
  ...issuedToken(),
  expires_at: expiresAt,
}));

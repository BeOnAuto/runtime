import { randomBytes } from 'node:crypto';

import { sha256Of } from '@on.auto/operations';
import { DateTime, Duration, Effect } from 'effect';

import type { OpenLink } from '../registry/registry.ts';

const tokenBytes = 32;

const tenMinutesMs = Duration.toMillis(Duration.minutes(10));

export const linkLastsMs = Duration.toMillis(Duration.hours(24));

export interface IssuedLink extends OpenLink {
  readonly token: string;
}

export function tokenSha256Of(token: string): string {
  return sha256Of(token);
}

export function tokenSha256OfPage(page: string): string {
  return tokenSha256Of(String(new URL(page).searchParams.get('token')));
}

function momentAfter(lastingMs: number): Effect.Effect<string> {
  return Effect.gen(function* () {
    return DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, lastingMs));
  });
}

export const tenMinutesOn: Effect.Effect<string> = momentAfter(tenMinutesMs);

export function issuedToken(): { readonly token: string; readonly token_sha256: string } {
  const token = randomBytes(tokenBytes).toString('base64url');
  return { token, token_sha256: tokenSha256Of(token) };
}

export const issuedLink: Effect.Effect<IssuedLink> = Effect.map(momentAfter(linkLastsMs), (expiresAt) => ({
  ...issuedToken(),
  expires_at: expiresAt,
}));

import type { PendingSignIn } from '@on.auto/openid-connect';

export interface PendingCookie {
  readonly valueOf: (pending: PendingSignIn) => string;
  readonly pendingIn: (value: string | undefined) => PendingSignIn | undefined;
}

const threeParts = /^([\w-]+)\.([\w-]+)\.([\w-]+)$/u;

const fourParts = /^([\w-]+)\.([\w-]+)\.([\w-]+)\.([\w-]+)$/u;

function partsOf({ state, nonce, codeVerifier }: PendingSignIn): readonly string[] {
  return [state, nonce, codeVerifier];
}

function checksIn([, state, nonce, codeVerifier]: readonly (string | undefined)[]): PendingSignIn {
  return { state: String(state), nonce: String(nonce), codeVerifier: String(codeVerifier) };
}

const withoutItsClient: PendingCookie = {
  valueOf: (pending) => partsOf(pending).join('.'),
  pendingIn: (value) => {
    const match = threeParts.exec(String(value));
    return match === null ? undefined : checksIn(match);
  },
};

const notingItsClient: PendingCookie = {
  valueOf: (pending) => [...partsOf(pending), Buffer.from(String(pending.clientId)).toString('base64url')].join('.'),
  pendingIn: (value) => {
    const match = fourParts.exec(String(value));
    return match === null
      ? undefined
      : { ...checksIn(match), clientId: Buffer.from(String(match[4]), 'base64url').toString('utf8') };
  },
};

export function pendingCookieOf(notesItsClient: boolean): PendingCookie {
  return notesItsClient ? notingItsClient : withoutItsClient;
}

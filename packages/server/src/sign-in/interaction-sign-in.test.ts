import type { PageStyle } from '@on.auto/api';
import {
  ClientRegistrationError,
  type PeopleRows,
  type PersonRow,
  type RelyingParty,
  type SignInAsked,
} from '@on.auto/openid-connect';
import { sealedSecretStoreOn } from '@on.auto/secrets';
import { memoryRows, recordingCustodian } from '@on.auto/secrets/testing';
import { DateTime, Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { signInReportTo } from '../logging/sign-in-logging.ts';
import { interactionSignInOf } from './interaction-sign-in.ts';
import { claimsIn, keptSecretsOf } from './issued-tokens.ts';
import { signInPagesOf } from './sign-in-pages.ts';

const relyingParty: RelyingParty = {
  issuer: 'https://login.example.com/tenant/v2.0',
  redirectUri: 'https://auto.example.com/auth/oidc/callback',
  signInStarted: () => Promise.reject(new Error('Not asked')),
  signInFinished: () => Promise.reject(new Error('Not asked')),
};

const aPending = { state: 'state', nonce: 'nonce', codeVerifier: 'verifier' };

const aPendingSignIn = 'a-pending-sign-in';

const ada: PersonRow = {
  person: 'ada',
  name: 'Ada Lovelace',
  emailAddress: 'ada@example.com',
  joinedAt: 1,
  updatedAt: 1,
};

const peopleWithAda: PeopleRows = {
  kept: () => Promise.resolve(),
  listed: () => Promise.resolve([]),
  found: (person) => Promise.resolve(person === ada.person ? ada : undefined),
  deleted: () => Promise.resolve(),
};

type SigningIn = Parameters<typeof interactionSignInOf>[0];

const enrollingRefused: SigningIn['enrolling'] = {
  enrolled: () => Promise.resolve({ failed: 'contended' }),
  holdsARole: (person) => Promise.resolve(person === ada.person),
  firstAdminAwaited: () => Promise.resolve(false),
  invitationPending: () => Promise.resolve(false),
};

type Logged = (log: Effect.Effect<void>) => void;

function stepWith(party: Partial<RelyingParty>, logged: Logged = Function.constVoid) {
  return interactionSignInOf({
    relyingParty: { ...relyingParty, ...party },
    pending: { valueOf: () => '', pendingIn: (value) => (value === aPendingSignIn ? aPending : undefined) },
    report: signInReportTo(logged, relyingParty.issuer),
    requiredClaim: undefined,
    people: peopleWithAda,
    invitations: { forgotten: () => Promise.resolve() },
    studioOpenedAt: 'https://studio.on.auto/?server=https%3A%2F%2Fauto.example.test&src=runtime-page',
    enrolling: enrollingRefused,
    setup: { requiredClaimSet: () => Promise.reject(new Error('Not asked')) },
  });
}

function startedWhen(signInStarted: RelyingParty['signInStarted'], logged?: Logged) {
  return stepWith({ signInStarted }, logged).started({ selectAccount: false });
}

describe('the start of a sign-in that cannot register its client', () => {
  it('answers that the sign-in did not start and logs it, and leaves any other failure to the incident it is', async () => {
    const refusal = { issuer: relyingParty.issuer, redirectUri: relyingParty.redirectUri, message: 'Refused' };
    const unregistered = new ClientRegistrationError({ ...refusal, refusal: { refused: 'invalid_client_metadata' } });
    const logs: Effect.Effect<void>[] = [];

    const notStarted = await startedWhen(
      () => Promise.reject(unregistered),
      (log) => {
        logs.push(log);
      },
    );

    expect([notStarted, logs.length]).toEqual([{ notStarted: true }, 1]);
    await expect(startedWhen(() => Promise.reject(new Error('A fault of the test')))).rejects.toThrow(
      'A fault of the test',
    );
  });
});

describe('the sign-in step, over the relying party', () => {
  it('asks the provider for the account choice where asked, and answers a failure where no sign-in of this browser started or the role could not be recorded', async () => {
    const asked: (SignInAsked | undefined)[] = [];
    const signedIn = { signedIn: { issuer: relyingParty.issuer, subject: 'ada' }, claims: {} };
    const step = stepWith({
      signInStarted: (prompt) => {
        asked.push(prompt);
        return Promise.resolve({ authorizationUrl: 'https://login.example.com/authorize', pending: aPending });
      },
      signInFinished: () => Promise.resolve(signedIn),
    });

    await step.started({ selectAccount: true });
    const unstarted = await step.finished('?code=a&state=b', 'another-sign-in');
    const unrecorded = await step.finished('?code=a&state=b', aPendingSignIn);

    expect(asked).toEqual([{ prompt: 'select_account' }]);
    expect([unstarted, unrecorded]).toEqual([{ refused: 'not_signed_in' }, { refused: 'not_signed_in' }]);
  });

  it('answers the claims of a person it keeps who holds a role, and nothing for one who holds none or is not kept', async () => {
    const claimsOf = claimsIn(peopleWithAda, { holdsARole: (person) => Promise.resolve(person === ada.person) });
    const withoutARole = claimsIn(peopleWithAda, { holdsARole: () => Promise.resolve(false) });

    expect([await claimsOf('ada'), await withoutARole('ada'), await claimsOf('priya')]).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      undefined,
      undefined,
    ]);
  });
});

const style: PageStyle = {
  head: () => '',
  readOnlyHeaders: { shown: 'read-only' },
  controlHeaders: {},
  formHeaders: (formAction) => ({ 'content-security-policy': `form-action ${formAction}` }),
};

describe('the pages of the sign-in step', () => {
  it('let the allow page post to the address its access goes to, for an agent that registered itself or one published at its document, and answer a request no longer open and a refusal with nothing to try again read-only', async () => {
    const pages = signInPagesOf(style);
    const allowing = { client: 'An agent', allowAt: '/interaction/a/confirm', denyAt: '/interaction/a/abort' };

    const shown = await Promise.all([
      pages({ allow: { ...allowing, publishedAt: undefined, deliveredTo: 'https://agent.example.com/callback' } }),
      pages({ allow: { ...allowing, publishedAt: 'agent.example.com', deliveredTo: 'com.example.agent:/callback' } }),
      pages({
        allow: { ...allowing, publishedAt: 'agent.example.com', deliveredTo: 'http://127.0.0.1:7777/callback' },
      }),
      pages({ notOpen: { client: 'An agent' } }),
      pages({ notOpen: { client: undefined } }),
      pages({ refused: 'not_signed_in', tryAgainAt: undefined }),
    ]);

    const readOnly = { shown: 'read-only' };
    expect(shown.map(({ status, headers }) => [status, headers])).toEqual([
      [200, { 'content-security-policy': "form-action 'self' https://agent.example.com" }],
      [200, { 'content-security-policy': "form-action 'self' com.example.agent:" }],
      [200, { 'content-security-policy': "form-action 'self' http://127.0.0.1:7777" }],
      [400, readOnly],
      [400, readOnly],
      [400, readOnly],
    ]);
  });
});

describe('the page that signs a person out', () => {
  it('posts the form it is given to the server itself, and lets its one script run by that script hash alone', async () => {
    const script = 'document.forms[0].submit()';
    const form =
      '<form method="post" action="/session/end/confirm"><input type="hidden" name="xsrf" value="x"/></form>';

    const { status, headers, html } = await signInPagesOf(style)({ signingOut: { form, script } });

    const itsScriptAlone: unknown = expect.stringMatching(/^form-action 'self'; script-src 'sha256-[\w+/]+=*'$/u);
    expect([status, headers]).toEqual([200, { 'content-security-policy': itsScriptAlone }]);
    expect(html).toMatch(/<noscript>.*<button [^>]*type="submit"[^>]*>.*<\/noscript><\/form><script>/u);
  });
});

describe("the key a runtime that signs people in signs ID Tokens with, in the runtime's secret store", () => {
  it('is kept sealed, read back by its id, forgotten by a server that another started before, and gone where it is sealed under a key the store no longer has', async () => {
    const rows = memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) });
    const secrets = keptSecretsOf(sealedSecretStoreOn(rows, { current: recordingCustodian() }));
    const underAnotherKey = keptSecretsOf(sealedSecretStoreOn(rows, { current: recordingCustodian() }));

    const id = await secrets.keep('a-signing-key');
    const read = [await secrets.read(id), await underAnotherKey.read(id)];
    await secrets.forget(id);

    expect([...read, await secrets.read(id)]).toEqual(['a-signing-key', undefined, undefined]);
  });
});

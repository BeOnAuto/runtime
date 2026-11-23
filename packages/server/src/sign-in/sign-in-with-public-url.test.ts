import { describe, expect, it, onTestFinished } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import {
  authorizationAskedBy,
  backFrom,
  claimOfTheDefault,
  fieldsOf,
  locationOf,
  publicUrl,
  registered,
  signingIn,
  toTheProvider,
  type Running,
} from './signing-in.ts';

async function startedOn(port: number, environment: Readonly<Record<string, string>>): Promise<RunningServer> {
  const ledger = temporaryLedger();
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: String(port), LEDGER_FILE: ledger.fileName, ...environment },
    testComposition(),
  );
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  return server;
}

describe('a runtime on its own loopback address', () => {
  it('signs no one in without PUBLIC_URL, serves no metadata and takes a request as the local developer', async () => {
    const server = await startedOn(await aPortNothingListensOn(), {});
    const metadata = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource`);
    const issuerKeys = await fetch(`http://127.0.0.1:${server.port}/oidc/.well-known/jwks.json`);
    const playbooks = await fetch(`http://127.0.0.1:${server.port}/v1/orgs/local/playbooks`);

    expect(server.signIn).toBeUndefined();
    expect([metadata.status, issuerKeys.status, playbooks.status]).toEqual([404, 404, 200]);
  });
});

async function returnedAs(signing: Running, who: string, idToken: Readonly<Record<string, unknown>>) {
  const browser = signing.aBrowser();
  const upstream = await toTheProvider(browser, { clientId: await registered(browser) });
  return backFrom(browser, signing.provider.signedIn(upstream, who, idToken));
}

describe('a runtime with PUBLIC_URL and no OIDC_ISSUER, signing people in at its default identity provider', () => {
  it('is its own authorization server, and shows a sign-in that cannot begin at the default provider as one that failed', async () => {
    const signing = await signingIn({ byDefault: true, provider: { registrationError: 'invalid_client_metadata' } });
    const browser = signing.aBrowser();
    const registeredAtStart = signing.provider.registrationsAsked().length;

    const metadata = await fieldsOf(await signing.at('/.well-known/oauth-protected-resource'));
    const asked = await browser.at(authorizationAskedBy({ clientId: await registered(browser) }));
    const begun = await browser.at(locationOf(asked));

    expect([registeredAtStart, signing.provider.registrationsAsked().length, begun.status]).toEqual([0, 1, 400]);
    expect(metadata['authorization_servers']).toEqual([publicUrl]);
  });
});

describe('a runtime with PUBLIC_URL and no OIDC_ISSUER, as its first sign-in sets it up', () => {
  it('registers itself as the first sign-in begins, records the value of the claim that sign-in carries, and from then on admits only a person carrying it, after a restart too', async () => {
    const signing = await signingIn({ byDefault: true });
    const registeredAtStart = signing.provider.registrationsAsked().length;

    const first = await returnedAs(signing, 'Ada', { [claimOfTheDefault]: 'acme' });
    const another = await returnedAs(signing, 'Priya', { [claimOfTheDefault]: 'another' });
    await signing.restarted();
    const anotherAgain = await returnedAs(signing, 'Priya', { [claimOfTheDefault]: 'another' });
    const colleague = await returnedAs(signing, 'Grace', { [claimOfTheDefault]: 'acme' });

    expect([registeredAtStart, first.status, another.status, anotherAgain.status, colleague.status]).toEqual([
      0, 303, 403, 403, 303,
    ]);
    expect(signing.provider.registrationsAsked().map((asked) => asked['client_uri'])).toEqual([publicUrl]);
    expect((await signing.peopleKept()).length).toBe(2);
    expect([
      await signing.factsKept('required_claim_set', 'value'),
      await signing.factsKept('role_assigned', 'source'),
    ]).toEqual([[{ field: 'acme' }], [{ field: 'bootstrap' }, { field: 'enrolment' }]]);
  });

  it('admits a person whose ID Token carries the value OIDC_REQUIRED_CLAIM gives of the claim, and no one else, recording no value of its own', async () => {
    const signing = await signingIn({
      byDefault: true,
      settings: { OIDC_REQUIRED_CLAIM: `${claimOfTheDefault}=acme` },
    });

    const carrying = await returnedAs(signing, 'Ada', { [claimOfTheDefault]: 'acme' });
    const another = await returnedAs(signing, 'Priya', { [claimOfTheDefault]: 'another' });

    expect([carrying.status, another.status]).toEqual([303, 403]);
    expect([(await signing.peopleKept()).length, await signing.factsKept('required_claim_set', 'value')]).toEqual([
      1,
      [],
    ]);
  });
});

describe('a runtime signing people in at its default identity provider, as it is sent more than it asks for', () => {
  it('reads the name of a person it admits at the UserInfo endpoint the provider declares, and hands back every refresh token it is sent unasked, a refused person’s too, whose name it never asks for', async () => {
    const provider = { userInfo: { name: 'Ada Lovelace' }, refreshTokens: true, revocation: true };
    const signing = await signingIn({ byDefault: true, provider });

    const first = await returnedAs(signing, 'Ada', { [claimOfTheDefault]: 'acme' });
    const another = await returnedAs(signing, 'Priya', { [claimOfTheDefault]: 'another' });

    const { userInfoReads, refreshTokensIssued, tokensRevoked } = signing.provider;
    expect([first.status, another.status, userInfoReads()]).toEqual([303, 403, 1]);
    expect(await signing.peopleKept()).toEqual([expect.objectContaining({ name: 'Ada Lovelace' })]);
    expect([refreshTokensIssued().length, tokensRevoked()]).toEqual([2, refreshTokensIssued()]);
  });
});

describe('a runtime with PUBLIC_URL, as the issuer of the subject tokens it exchanges at other services', () => {
  it('answers its metadata and its key set under /oidc to a page of any origin, with the one key it made at its first start and reads again after a restart', async () => {
    const signing = await signingIn({ byDefault: true });
    const fromElsewhere = { headers: { origin: 'https://elsewhere.example.test' } };

    const metadataAnswer = await signing.at('/oidc/.well-known/openid-configuration', fromElsewhere);
    const keySetAnswer = await signing.at('/oidc/.well-known/jwks.json', fromElsewhere);
    const [metadata, keySet] = [await fieldsOf(metadataAnswer), await fieldsOf(keySetAnswer)];
    await signing.restarted();
    const keySetAgain = await fieldsOf(await signing.at('/oidc/.well-known/jwks.json'));

    expect(
      [metadataAnswer, keySetAnswer].map(({ status, headers }) => [status, headers.get('access-control-allow-origin')]),
    ).toEqual([
      [200, '*'],
      [200, '*'],
    ]);
    expect(metadata).toMatchObject({
      issuer: `${publicUrl}/oidc`,
      jwks_uri: `${publicUrl}/oidc/.well-known/jwks.json`,
    });
    expect(keySet['keys']).toEqual([expect.objectContaining({ kty: 'RSA', alg: 'RS256', use: 'sig' })]);
    expect(keySetAgain).toEqual(keySet);
    expect(await signing.factsKept('subject_token_signing_key_kept', 'secret_id')).toHaveLength(1);
  });
});

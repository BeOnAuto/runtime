import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { identityServiceOf } from '../index.ts';
import { fakeIssuer } from './fake-issuer.ts';
import { principalIn } from './principals.ts';
import { hostedStudio } from './studios.ts';

const clients = { 'ada-agent': { secret: 'a-long-secret', claims: { sub: 'ada', org_id: 'acme' } } };

const tokenOf = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));

const timesOf = Schema.decodeUnknownSync(Schema.Struct({ iat: Schema.Number, nbf: Schema.Number, exp: Schema.Number }));

function tokenRequest(credentials: string, form: Readonly<Record<string, string>>): Request {
  return new Request('https://login.example/token', {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` },
    body: new URLSearchParams(form),
  });
}

describe('the fake issuer', () => {
  it('mints a token for a client by its credentials, for the resource and the scopes asked, that the runtime verifies', async () => {
    const fake = fakeIssuer('https://login.example', { clients });
    const identityService = await identityServiceOf(
      { issuer: fake.issuer, publicUrl: 'https://runtime.example', studio: hostedStudio, allowedOrigins: [] },
      { fetch: fake.answer, now: Date.now },
    );

    const answer = await fake.answer(
      tokenRequest('ada-agent:a-long-secret', {
        grant_type: 'client_credentials',
        resource: 'https://runtime.example',
        scope: 'user:org:read org:read',
      }),
    );
    const { access_token: token } = tokenOf(await answer.json());

    expect(principalIn(await identityService.personOf(token, '/mcp'))?.callerIn('acme')).toMatchObject({
      id: 'person:ada',
      permissions: ['org:read'],
    });
  });
});

describe('the fake issuer refusing', () => {
  it.each([
    ['a wrong secret', 'ada-agent:another-secret', 'client_credentials'],
    ['an unknown client', 'grace-agent:a-long-secret', 'client_credentials'],
    ['another grant', 'ada-agent:a-long-secret', 'password'],
  ])('refuses %s', async (_case, credentials, grant) => {
    const answer = await fakeIssuer('https://login.example', { clients }).answer(
      tokenRequest(credentials, { grant_type: grant }),
    );

    expect([answer.status, await answer.json()]).toEqual([401, { error: 'invalid_client' }]);
  });
});

describe('the fake issuer answering', () => {
  it('mints a token for the issuer itself when no resource is asked', async () => {
    const fake = fakeIssuer('https://login.example', { clients });
    const answer = await fake.answer(tokenRequest('ada-agent:a-long-secret', { grant_type: 'client_credentials' }));
    const { access_token: token } = tokenOf(await answer.json());

    expect(JSON.parse(Buffer.from(String(token.split('.')[1]), 'base64url').toString('utf8'))).toMatchObject({
      aud: 'https://login.example',
      scope: '',
    });
  });

  it('answers 404 on a path it does not serve', async () => {
    expect(
      (await fakeIssuer('https://login.example').answer(new Request('https://login.example/userinfo'))).status,
    ).toBe(404);
  });
});

function segmentOf(token: string, index: number): unknown {
  return JSON.parse(Buffer.from(String(token.split('.')[index]), 'base64url').toString('utf8'));
}

describe('the fake issuer giving a page its session', () => {
  it('issues the session of version 2 the identity service sends, of a minute, to the page as azp, its org as o', async () => {
    const session = await fakeIssuer('https://login.example').session('https://studio.example');
    const claims = segmentOf(session, 1);
    const { iat, nbf, exp } = timesOf(claims);

    expect([segmentOf(session, 0), claims]).toEqual([
      { alg: 'RS256', kid: 'rs256-1', typ: 'JWT' },
      {
        iss: 'https://login.example',
        sub: 'ada',
        sid: 'session-1',
        azp: 'https://studio.example',
        iat,
        nbf,
        exp,
        v: 2,
        o: { id: 'acme', slg: 'acme', rol: 'admin', per: 'manage,read', fpm: '3' },
      },
    ]);
    expect([nbf - iat, exp - iat]).toEqual([0, 60]);
  });

  it('issues the session with the claims a test gives in place of its own, o among them whole, and none it removes', async () => {
    const session = await fakeIssuer('https://login.example').session('https://studio.example', {
      sub: 'grace',
      o: { id: 'globex' },
      v: undefined,
    });
    const claims = segmentOf(session, 1);

    expect(claims).toMatchObject({ sub: 'grace', azp: 'https://studio.example' });
    expect(claims).toHaveProperty('o', { id: 'globex' });
    expect(claims).not.toHaveProperty('v');
  });

  it('names each session it issues by a sid of its own', async () => {
    const fake = fakeIssuer('https://login.example');
    const sessions = [await fake.session('https://studio.example'), await fake.session('https://studio.example')];

    expect(sessions.map((session) => segmentOf(session, 1))).toMatchObject([
      { sid: 'session-1' },
      { sid: 'session-2' },
    ]);
  });
});

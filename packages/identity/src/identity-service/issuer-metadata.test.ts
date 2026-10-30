import { describe, expect, it } from 'vitest';

import { identityServiceOf, type IssuerFetch } from '../index.ts';
import { fakeIssuer, hostedStudio } from '../testing/index.ts';
import { metadataAddressesOf } from './issuer-metadata.ts';

const publicUrl = 'https://runtime.example';

interface Answering {
  readonly fetch: IssuerFetch;
  readonly asked: () => readonly string[];
}

const nothingThere: IssuerFetch = () => Promise.resolve(new Response(null, { status: 404 }));

function answering(answers: Readonly<Record<string, Response>>, otherwise: IssuerFetch): Answering {
  const asked: string[] = [];
  const byAddress = new Map(Object.entries(answers));
  return {
    fetch: (request) => {
      asked.push(request.url);
      const answer = byAddress.get(request.url);
      return answer === undefined ? otherwise(request) : Promise.resolve(answer);
    },
    asked: () => [...asked],
  };
}

function json(body: unknown): Response {
  return Response.json(body);
}

async function refusalOf(issuer: string, fetch: IssuerFetch): Promise<string> {
  try {
    await identityServiceOf({ issuer, publicUrl, studio: hostedStudio, allowedOrigins: [] }, { fetch, now: Date.now });
  } catch (error) {
    return String(error);
  }
  return 'started';
}

const oauthAddress = 'https://login.example/.well-known/oauth-authorization-server';

const openIdAddress = 'https://login.example/.well-known/openid-configuration';

describe('the metadata addresses of an issuer', () => {
  it('are the OAuth and then the OpenID Connect document at its origin, the order of the MCP specification', () => {
    expect([metadataAddressesOf('https://login.example'), metadataAddressesOf('https://login.example/')]).toEqual([
      [oauthAddress, openIdAddress],
      [oauthAddress, openIdAddress],
    ]);
  });
});

describe('reading the metadata of an issuer at start', () => {
  it('goes on to the next address while one answers nothing it can use, and reads the key set it names', async () => {
    const fake = fakeIssuer('https://login.example');
    const metadata = {
      issuer: fake.issuer,
      jwks_uri: 'https://login.example/jwks',
      id_token_signing_alg_values_supported: ['RS256'],
    };
    const answers = answering(
      { [oauthAddress]: new Response('gone', { status: 404 }), [openIdAddress]: json(metadata) },
      fake.answer,
    );

    expect(await refusalOf(fake.issuer, answers.fetch)).toBe('started');
    expect(answers.asked()).toEqual([oauthAddress, openIdAddress, 'https://login.example/jwks']);
  });

  it('refuses metadata that names another issuer, such as one with a path', async () => {
    const answers = answering(
      {
        [oauthAddress]: json({ issuer: 'https://login.example/tenant', jwks_uri: 'https://login.example/jwks' }),
      },
      nothingThere,
    );

    expect(await refusalOf('https://login.example', answers.fetch)).toContain(
      `${oauthAddress} names the issuer https://login.example/tenant; ${openIdAddress} answers 404`,
    );
  });

  it.each([
    ['a timeout', new DOMException('The operation timed out', 'TimeoutError'), 'does not answer within 10 seconds'],
    ['a failed connection', new TypeError('fetch failed'), 'cannot be reached'],
  ])('says so for %s', async (_case, failure: Readonly<Error>, words) => {
    expect(await refusalOf('https://login.example', () => Promise.reject(failure))).toContain(
      `${oauthAddress} ${words}; ${openIdAddress} ${words}`,
    );
  });
});

describe('the metadata of an issuer the runtime refuses', () => {
  it.each([
    ['an answer that is not JSON', new Response('<html>'), 'answers no JSON'],
    ['an answer without a body', new Response(null), 'answers no JSON'],
    [
      'JSON without a jwks_uri',
      json({ issuer: 'https://login.example' }),
      'answers no metadata with an issuer and a jwks_uri',
    ],
    [
      'a jwks_uri that is not https',
      json({ issuer: 'https://login.example', jwks_uri: 'http://login.example/jwks' }),
      'names a jwks_uri that is not an https URL',
    ],
    [
      'a redirect, which it does not follow',
      new Response(null, { status: 302, headers: { location: 'http://login.example/elsewhere' } }),
      'answers a redirect, which the runtime does not follow',
    ],
    [
      'an answer over 64 KiB',
      json({ issuer: 'https://login.example', padding: 'x'.repeat(65_536) }),
      'answers more than 64 KiB',
    ],
  ])('is %s, and the refusal names the service and each address it read', async (_case, answer, words) => {
    const answers = answering({ [oauthAddress]: answer }, nothingThere);

    expect(await refusalOf('https://login.example', answers.fetch)).toBe(
      `UnusableIdentityServiceError: The identity service at https://login.example cannot be used: no metadata of https://login.example could be used: ${oauthAddress} ${words}; ${openIdAddress} answers 404`,
    );
  });
});

describe('the key set of an issuer the runtime refuses at start', () => {
  it.each([
    ['an answer over 64 KiB', json({ keys: [], padding: 'x'.repeat(65_536) }), 'answers more than 64 KiB'],
    ['an answer without keys', json({ issuer: 'https://login.example' }), 'answers no key set'],
    [
      'a redirect, which it does not follow',
      new Response(null, { status: 307, headers: { location: 'http://login.example/jwks' } }),
      'answers a redirect, which the runtime does not follow',
    ],
    ['an empty key set', json({ keys: [] }), 'holds no keys'],
  ])('is %s', async (_case, answer, words) => {
    const fake = fakeIssuer('https://login.example');
    const answers = answering({ 'https://login.example/jwks': answer }, fake.answer);

    expect(await refusalOf(fake.issuer, answers.fetch)).toBe(
      `UnusableIdentityServiceError: The identity service at https://login.example cannot be used: its key set at https://login.example/jwks ${words}`,
    );
  });
});

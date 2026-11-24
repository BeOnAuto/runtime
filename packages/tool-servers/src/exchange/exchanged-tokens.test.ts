import { describe, expect, it } from 'vitest';

import { AssertionRefused } from '../assertions/assertion-refused.ts';
import { TokenRequestFailed } from '../assertions/token-request-failed.ts';
import { exchangeCheckedOf, exchangedTokensOf, SubjectTokensAbsent, type Exchanging } from './exchanged-tokens.ts';
import type { SubjectTokens } from './subject-tokens.ts';
import { exchangeParametersTheRuntimeSets, jwtTokenType, type TokenExchange } from './token-exchanges.ts';

const moment = Date.parse('2026-11-23T09:00:00.000Z');

const anHourOn = '2026-11-23T10:00:00Z';

const tokenEndpoint = 'https://sts.service.example.com/v1/token';

const accountTokenUrl = 'https://credentials.service.example.com/v1/accounts/robot@acme.example.com:token';

const exchange: TokenExchange = {
  token_endpoint: tokenEndpoint,
  audience: '//identity.service.example.com/pools/auto/providers/auto',
  subject_token: { type: jwtTokenType, audience: 'https://identity.service.example.com/pools/auto/providers/auto' },
};

const impersonation = {
  method: 'POST',
  url: accountTokenUrl,
  request: { scope: '/scope' },
  issued: { access_token: '/accessToken', expires_at: '/expireTime' },
} as const;

const impersonating: TokenExchange = {
  ...exchange,
  parameters: { requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: 'service.all' },
  impersonation,
};

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

type Answer = (url: string) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const exchanged = json(200, {
  access_token: 'exchanged-1',
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  token_type: 'Bearer',
  expires_in: 3599,
});

const ofTheAccount = json(200, { accessToken: 'account-1', expireTime: anHourOn });

function answeringWith(answers: Readonly<Record<string, Response>>): Answer {
  return (url) => answers[url]?.clone() ?? new Response(null, { status: 404 });
}

const bothAnswer = answeringWith({ [tokenEndpoint]: exchanged, [accountTokenUrl]: ofTheAccount });

function exchangeAnswering(first: Response, then: Answer): Answer {
  return (url) => (url === tokenEndpoint ? first.clone() : then(url));
}

interface Signing extends SubjectTokens {
  readonly asked: readonly { readonly org: string; readonly audience: string }[];
}

function signing(): Signing {
  const asked: { readonly org: string; readonly audience: string }[] = [];
  return {
    issuer: 'https://auto.example.com/oidc',
    asked,
    signedFor: (each) => {
      asked.push(each);
      return Promise.resolve(`signed-for-${each.org}`);
    },
    keySet: () => Promise.resolve({ keys: [] }),
  };
}

function exchangingWith(answer: Answer, changes: Partial<Exchanging> = {}) {
  const sent: Sent[] = [];
  const subjectTokens = signing();
  const fetch = async (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    const { url, method } = request;
    sent.push({ url, method, headers: Object.fromEntries(request.headers), body: await request.text() });
    return answer(url);
  };
  const exchanging: Exchanging = { fetch, now: () => moment, subjectTokens, org: 'org_acme', ...changes };
  return { exchanging, sent, subjectTokens };
}

function formOf(sent: Sent | undefined): Readonly<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(sent?.body));
}

describe('the exchange of a subject token, RFC 8693', () => {
  it('posts a form with the grant, the audience and a JWT signed for the organization, then reads the token and when it ends', async () => {
    const { exchanging, sent, subjectTokens } = exchangingWith(bothAnswer);

    const tokens = await exchangedTokensOf(exchange, 'service.read service.list', exchanging);

    expect(tokens).toEqual({ access_token: 'exchanged-1', expires_in: 3599 });
    expect(subjectTokens.asked).toEqual([{ org: 'org_acme', audience: exchange.subject_token.audience }]);
    expect(sent.map(({ url, method, headers }) => [url, method, headers['content-type']])).toEqual([
      [tokenEndpoint, 'POST', 'application/x-www-form-urlencoded'],
    ]);
    expect(formOf(sent[0])).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: exchange.audience,
      subject_token: 'signed-for-org_acme',
      subject_token_type: jwtTokenType,
      scope: 'service.read service.list',
    });
  });

  it.each([
    ['no scope', undefined],
    ['an empty scope', ''],
  ] as const)('sends no scope where the way asks %s', async (_named, scope) => {
    const { exchanging, sent } = exchangingWith(bothAnswer);

    await exchangedTokensOf(exchange, scope, exchanging);

    expect(Object.keys(formOf(sent[0]))).not.toContain('scope');
  });

  it('sends the parameters of the way beside the ones it sets itself, never in their place', async () => {
    const { exchanging, sent } = exchangingWith(bothAnswer);
    const written = { ...exchange, parameters: { requested_token_type: 'access', audience: 'elsewhere' } };

    await exchangedTokensOf(written, undefined, exchanging);

    expect(formOf(sent[0])).toMatchObject({ requested_token_type: 'access', audience: exchange.audience });
  });
});

describe('the impersonation that turns an exchanged token into the token of the account', () => {
  it('turns the exchanged token into the token of the account, posting the scopes as a list where the way points', async () => {
    const { exchanging, sent } = exchangingWith(bothAnswer);

    const tokens = await exchangedTokensOf(impersonating, 'service.read service.list', exchanging);

    expect(tokens).toEqual({ access_token: 'account-1', expires_in: 3600 });
    expect(formOf(sent[0])).toMatchObject({ scope: 'service.all' });
    expect(sent[1]).toEqual({
      url: accountTokenUrl,
      method: 'POST',
      headers: { authorization: 'Bearer exchanged-1', accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ scope: ['service.read', 'service.list'] }),
    });
  });

  it.each([
    ['/scope', { scope: ['service.read'] }],
    ['/request/scopes', { request: { scopes: ['service.read'] } }],
    ['/a~1b/c~0d', { 'a/b': { 'c~d': ['service.read'] } }],
    ['', ['service.read']],
  ] as const)('posts the scopes at %s as %o', async (pointer, body) => {
    const { exchanging, sent } = exchangingWith(bothAnswer);
    const pointed = { ...impersonating, impersonation: { ...impersonation, request: { scope: pointer } } };

    await exchangedTokensOf(pointed, 'service.read', exchanging);

    expect(JSON.parse(String(sent[1]?.body))).toEqual(body);
  });

  it('takes the token of the account to last as long as its answer says, or an hour where it says nothing', async () => {
    const { exchanging } = exchangingWith(
      answeringWith({ [tokenEndpoint]: exchanged, [accountTokenUrl]: json(200, { accessToken: 'account-2' }) }),
    );

    await expect(exchangedTokensOf(impersonating, 'service.read', exchanging)).resolves.toEqual({
      access_token: 'account-2',
    });
  });
});

describe('a server with nothing to sign a subject token with', () => {
  it.each([
    ['no subject tokens', { subjectTokens: undefined }],
    ['no organization', { org: undefined }],
  ] as const)('asks nothing where the server has %s to sign with', async (_named, changes) => {
    const { exchanging, sent } = exchangingWith(bothAnswer, changes);

    await expect(exchangedTokensOf(exchange, undefined, exchanging)).rejects.toBeInstanceOf(SubjectTokensAbsent);
    expect(sent).toEqual([]);
  });
});

describe('an exchange the service does not answer with a token', () => {
  it.each([
    ['the exchange', json(400, { error: 'invalid_grant' }), bothAnswer, 'invalid_grant'],
    ['the exchange', json(401, { error: 'invalid_client' }), bothAnswer, 'invalid_client'],
    ['the request for the account', exchanged, () => json(403, { error: { status: 'PERMISSION_DENIED' } }), 'HTTP 403'],
    ['the request for the account', exchanged, () => json(404, {}), 'HTTP 404'],
  ] as const)('refuses where %s is refused, naming %s', async (_named, first, then, code) => {
    const { exchanging } = exchangingWith(exchangeAnswering(first, then));

    const refused = exchangedTokensOf(impersonating, 'service.read', exchanging);

    await expect(refused).rejects.toBeInstanceOf(AssertionRefused);
    await expect(refused).rejects.toMatchObject({ code });
  });

  it.each([
    ['the exchange', json(503, {}), bothAnswer, true],
    ['the exchange', json(400, { error: 'temporarily_unavailable' }), bothAnswer, true],
    ['the exchange', json(200, { token_type: 'Bearer' }), bothAnswer, false],
    ['the request for the account', exchanged, () => json(500, {}), true],
    ['the request for the account', exchanged, () => json(429, {}), true],
    ['the request for the account', exchanged, () => json(200, { expireTime: anHourOn }), false],
  ] as const)('fails where %s fails, telling whether a later try may pass', async (_named, first, then, passing) => {
    const { exchanging } = exchangingWith(exchangeAnswering(first, then));

    const failed = exchangedTokensOf(impersonating, 'service.read', exchanging);

    await expect(failed).rejects.toBeInstanceOf(TokenRequestFailed);
    await expect(failed).rejects.toMatchObject({ passing });
  });
});

describe('the check of an exchange, made once before a connection is kept', () => {
  it.each([
    ['taken', bothAnswer, { kind: 'taken' }],
    ['refused', () => json(400, { error: 'invalid_grant' }), { kind: 'refused', code: 'invalid_grant' }],
    [
      'unanswered',
      () => json(200, {}),
      {
        kind: 'unanswered',
        call: { step: 'token', host: 'sts.service.example.com', answer: { failed: 'unreadable' } },
      },
    ],
    ['unreached', () => json(502, {}), { kind: 'unreached', hosts: ['sts.service.example.com'] }],
  ] as const)('answers %s', async (_named, answer, checked) => {
    const { exchanging } = exchangingWith(answer);

    await expect(exchangeCheckedOf(exchange, 'service.read', exchanging)).resolves.toEqual(checked);
  });
});

describe('the parameters the runtime sets in an exchange itself', () => {
  it.each([
    [{ requested_token_type: 'access' }, false, []],
    [
      { grant_type: 'g', subject_token: 's', subject_token_type: 't', audience: 'a' },
      true,
      ['grant_type', 'subject_token', 'subject_token_type', 'audience'],
    ],
    [{ scope: 'service.all' }, false, ['scope']],
    [{ scope: 'service.all' }, true, []],
  ] as const)('of %o, where the way impersonates: %s, are %o', (parameters, impersonates, set) => {
    expect(exchangeParametersTheRuntimeSets(parameters, impersonates)).toEqual(set);
  });
});

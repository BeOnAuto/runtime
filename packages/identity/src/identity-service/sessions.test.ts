import { allPermissions } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { defaultStudioOrigin } from '../index.ts';
import {
  fakeIssuer,
  principalIn,
  servedStudio,
  signedTokens,
  testAllowedOrigin,
  testPublicUrl,
  type Claims,
} from '../testing/index.ts';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

const seconds = startedAt / 1000;

const atStart = { now: () => startedAt };

const everyPermissionOverEveryPlaybook = { permissions: allPermissions, playbooks: '*' };

const pageRefusal = 'ERR_JWT_CLAIM_VALIDATION_FAILED on its azp claim';

const noOrgClaim = 'ERR_JWT_CLAIM_VALIDATION_FAILED on its o claim';

const orgRefusal = 'its o.id claim is not an org id other than local';

const scopesASessionMayHold: ReadonlyArray<readonly [string, unknown]> = [
  ['a scope that grants one permission', 'user:org:read org:read'],
  ['a scope that is not a string', ['org:read']],
];

describe('a session the identity service gave a page', () => {
  it.each([
    ['the studio', defaultStudioOrigin],
    ['an origin of ALLOWED_ORIGINS', testAllowedOrigin],
  ])(
    'from %s is the person of the org its o claim names, with every permission over every playbook, and of no other org',
    async (_case, page) => {
      const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
      const person = principalIn(
        await identityService.personOf(await session(page, { o: { id: 'globex' } }), '', page),
      );

      expect(person?.own).toEqual({ id: 'person:ada', org: 'globex', ...everyPermissionOverEveryPlaybook });
      expect(person?.callerIn('acme')).toBeUndefined();
    },
  );

  it.each(scopesASessionMayHold)(
    'gives every permission whatever it holds, %s among it, since a session carries no scopes',
    async (_case, scope) => {
      const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
      const person = principalIn(
        await identityService.personOf(await session(defaultStudioOrigin, { scope }), '/mcp', defaultStudioOrigin),
      );

      expect(person?.own.permissions).toEqual(allPermissions);
    },
  );

  it('is taken on an MCP endpoint from its page, though it names no audience', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = await identityService.personOf(
      await session(defaultStudioOrigin),
      '/orgs/acme/mcp',
      defaultStudioOrigin,
    );

    expect(principalIn(person)?.own.id).toBe('person:ada');
  });
});

describe('a session read for its o claim', () => {
  it('gives every permission whatever role and permissions its o names, since the runtime reads its id alone', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const o = { id: 'acme', slg: 'acme', rol: 'member', per: 'read', fpm: '1' };
    const person = principalIn(
      await identityService.personOf(await session(defaultStudioOrigin, { o }), '', defaultStudioOrigin),
    );

    expect(person?.own).toEqual({ id: 'person:ada', org: 'acme', ...everyPermissionOverEveryPlaybook });
  });

  it('is the person of the org its o.id names, never of an org_id it holds', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const claims = { o: { id: 'globex' }, org_id: 'initech' };
    const person = principalIn(
      await identityService.personOf(await session(defaultStudioOrigin, claims), '', defaultStudioOrigin),
    );

    expect(['globex', 'initech'].map((org) => person?.callerIn(org)?.org)).toEqual(['globex', undefined]);
  });
});

describe('a session given to the page the runtime serves at its own origin', () => {
  it('is the person of its org where the runtime serves Studio, since its public URL is then a page origin', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart, servedStudio);
    const person = principalIn(await identityService.personOf(await session(testPublicUrl), '', testPublicUrl));

    expect(person?.own).toEqual({ id: 'person:ada', org: 'acme', ...everyPermissionOverEveryPlaybook });
  });

  it('is refused for its azp where the runtime serves no Studio', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session(testPublicUrl), '', testPublicUrl)).toEqual({
      because: pageRefusal,
    });
  });
});

const presentedByAnotherPage = 'the session was not presented by the page it was issued to';

describe('a session presented by any other than its own page', () => {
  it.each([
    ['without an origin, as an agent presents it', '/mcp', undefined],
    ['without an origin, over HTTP', '', undefined],
    ['from another origin the runtime allows', '', testAllowedOrigin],
    ['from its origin over http', '', 'http://studio.on.auto'],
  ])('is refused %s, naming no value', async (_case, resourcePath, requestOrigin) => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session(defaultStudioOrigin), resourcePath, requestOrigin)).toEqual({
      because: presentedByAnotherPage,
    });
  });

  it('is refused for its azp first when the page it names is not one the runtime allows', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session('https://elsewhere.example'), '')).toEqual({
      because: pageRefusal,
    });
  });
});

const refusedSessions: ReadonlyArray<readonly [string, string, Claims, string]> = [
  ['another origin', 'https://elsewhere.example', {}, pageRefusal],
  ['the studio over http', 'http://studio.on.auto', {}, pageRefusal],
  ['the studio with a final slash', `${defaultStudioOrigin}/`, {}, pageRefusal],
  ['the public URL of the runtime', testPublicUrl, {}, pageRefusal],
  ['an azp that is not a string', defaultStudioOrigin, { azp: 7 }, pageRefusal],
  ['no o', defaultStudioOrigin, { o: undefined }, noOrgClaim],
  ['no o, though it holds an org_id', defaultStudioOrigin, { o: undefined, org_id: 'acme' }, noOrgClaim],
  ['an o that is no object', defaultStudioOrigin, { o: 'acme' }, orgRefusal],
  ['an o without an id', defaultStudioOrigin, { o: {} }, orgRefusal],
  ['an o whose id is the org of local mode', defaultStudioOrigin, { o: { id: 'local' } }, orgRefusal],
  ['an o whose id is no org id', defaultStudioOrigin, { o: { id: 'ac me' } }, orgRefusal],
  ['an o whose id is not a string', defaultStudioOrigin, { o: { id: 7 } }, orgRefusal],
  ['no sub', defaultStudioOrigin, { sub: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its sub claim'],
  [
    'a wrong iss',
    defaultStudioOrigin,
    { iss: 'https://elsewhere.example' },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its iss claim',
  ],
  ['an exp past the leeway', defaultStudioOrigin, { exp: seconds - 60 }, 'ERR_JWT_EXPIRED on its exp claim'],
  ['no exp', defaultStudioOrigin, { exp: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its exp claim'],
];

describe('a session the runtime refuses, saying why', () => {
  it.each(refusedSessions)('is refused from %s', async (_case, page, claims, because) => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session(page, claims), '', defaultStudioOrigin)).toEqual({ because });
  });

  it('is refused when another key signed it', async () => {
    const { identityService } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const other = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await other.session(defaultStudioOrigin), '', defaultStudioOrigin)).toEqual({
      because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });
});

describe('a token that holds both aud and azp', () => {
  it('is judged as an access token, refused for an audience of another resource whatever page it names', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(
      await identityService.personOf(await token({ aud: 'https://other.example', azp: defaultStudioOrigin }), '/mcp'),
    ).toEqual({ because: 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim' });
  });

  it('is judged as an access token, with the permissions among its scopes alone', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const claims = { azp: defaultStudioOrigin, scope: 'user:org:read org:read' };

    expect(principalIn(await identityService.personOf(await token(claims), '/mcp'))?.own.permissions).toEqual([
      'org:read',
    ]);
  });

  it('is judged as an access token when its azp names no page the runtime allows', async () => {
    const { callerOf, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ azp: 'https://elsewhere.example' }))).toBe('person:ada');
  });

  it('is judged as an access token whatever origin presents it, or none', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const accessToken = await token({ azp: defaultStudioOrigin });

    expect(
      await Promise.all(
        [undefined, testAllowedOrigin].map(
          async (origin) => principalIn(await identityService.personOf(accessToken, '/mcp', origin))?.own.id,
        ),
      ),
    ).toEqual(['person:ada', 'person:ada']);
  });
});

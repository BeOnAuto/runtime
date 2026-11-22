import { describe, expect, it } from 'vitest';

import { defaultStudioOrigin } from '../index.ts';
import { fakeIssuer, principalIn, signedTokens, type Claims } from '../testing/index.ts';

const atStart = { now: () => Date.parse('2026-10-13T09:00:00Z') };

const ofTheBytesOfAReference = `${'ü'.repeat(127)}ab`;

describe('the person a token names, by id and by name', () => {
  it('is named by a subject of 256 bytes', async () => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ sub: ofTheBytesOfAReference }))).toBe(`person:${ofTheBytesOfAReference}`);
  });

  it('is called by the name its name claim gives, of up to 256 bytes', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const names = await Promise.all(
      ['Ada Lovelace', 'ada', ofTheBytesOfAReference].map(
        async (name) => principalIn(await identityService.personOf(await token({ name }), '/mcp'))?.own.name,
      ),
    );

    expect(names).toEqual(['Ada Lovelace', 'ada', ofTheBytesOfAReference]);
  });

  it('is called by its subject where an access token names no one, as an identity service may issue it', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(
      await identityService.personOf(await token({ sub: 'user_ada', name: undefined }), '/mcp'),
    );

    expect([person?.own.id, person?.own.name]).toEqual(['person:user_ada', 'user_ada']);
  });
});

const orgsOfNoName: ReadonlyArray<readonly [string, Claims, string]> = [
  ['no org_name', {}, 'acme'],
  ['an empty org_name', { org_name: '' }, 'acme'],
  ['an org_name that is not a string', { org_name: 7 }, 'acme'],
  ['an org_name over 256 bytes', { org_name: 'ü'.repeat(129) }, 'acme'],
  ['an org_name with a line break', { org_name: 'Initech\nInc' }, 'acme'],
  ['an org_name with a noncharacter', { org_name: 'Initech\uFFFF' }, 'acme'],
  ['an org_name beside no org_id', { org_id: undefined, sub: 'user_ada', org_name: 'Initech' }, 'user_ada'],
];

describe('the organization a token names, by its name', () => {
  it('is named by the name its org_name claim gives beside its org_id, of up to 256 bytes', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const named = await Promise.all(
      ['Initech', ofTheBytesOfAReference].map(async (orgName) => {
        const person = principalIn(await identityService.personOf(await token({ org_name: orgName }), '/mcp'));
        return [person?.own.org, person?.orgName];
      }),
    );

    expect(named).toEqual([
      ['acme', 'Initech'],
      ['acme', ofTheBytesOfAReference],
    ]);
  });

  it.each(orgsOfNoName)(
    'is named by no name, and the token refused for nothing, for %s',
    async (_case, claims, org) => {
      const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
      const person = principalIn(await identityService.personOf(await token(claims), '/mcp'));

      expect([person?.own.org, person?.orgName]).toEqual([org, undefined]);
    },
  );

  it('is named by no name in a session, which names its org in its o claim', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const page = defaultStudioOrigin;
    const person = principalIn(await identityService.personOf(await session(page, { org_name: 'Initech' }), '', page));

    expect([person?.own.org, person?.orgName]).toEqual(['acme', undefined]);
  });
});

function refusalOf(claim: string): string {
  return `its ${claim} is not a non-empty string of at most 256 bytes without control characters, unpaired surrogates or noncharacters`;
}

const refusedNames: ReadonlyArray<readonly [string, Claims, string]> = [
  ['no sub', { sub: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its sub claim'],
  ['an empty sub', { sub: '' }, refusalOf('sub')],
  ['a sub that is not a string', { sub: 7 }, refusalOf('sub')],
  ['a sub over 256 bytes', { sub: 'ü'.repeat(129) }, refusalOf('sub')],
  ['a sub with a control character', { sub: 'ada\u0000' }, refusalOf('sub')],
  ['a sub with a noncharacter', { sub: 'ada\uFFFF' }, refusalOf('sub')],
  ['an empty name', { name: '' }, refusalOf('name')],
  ['a name that is not a string', { name: { given: 'Ada' } }, refusalOf('name')],
  ['a name over 256 bytes', { name: 'ü'.repeat(129) }, refusalOf('name')],
  ['a name with a control character', { name: 'Ada\nLovelace' }, refusalOf('name')],
  ['a name with a noncharacter', { name: 'Ada\uFFFF' }, refusalOf('name')],
];

describe('a token whose person the runtime cannot name', () => {
  it.each(refusedNames)('is refused for %s, naming the claim', async (_case, claims, because) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token(claims), '/mcp')).toEqual({ because });
  });
});

import { consentedAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, type Added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, finishing, startedAt } from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

function revocationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/revoke').length;
}

function keptTokensIn(h: Harness): readonly string[] {
  return [...h.secrets.values().values()].filter((value) => value.includes('access_token'));
}

function filesOf(h: Harness): Promise<Added> {
  return added(h, { provider: 'files' });
}

describe('the finish of a consent', () => {
  it('redeems the code, keeps the tokens sealed, forgets the verifier, and records the approval and the connection in one write', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);
    const consented = await consentedOf(h, link);

    const finished = await finishing(h, link, consented);
    const facts = await h.facts();

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'connected',
        credential: {
          kind: 'authorization',
          client_id: 'auto-runtime',
          client_source: 'registered',
          scope: 'files.read',
        },
        granted_scope: 'files.read',
        credential_ends_with: null,
      },
    });
    expect(facts.slice(-2).map(({ type, data }) => [type, data])).toEqual([
      ['connection_approved', { connection: link.id }],
      [
        'connection_connected',
        {
          connection: link.id,
          secret_id: 'secret-2',
          client_id: 'auto-runtime',
          client_source: 'registered',
          scope: 'files.read',
          connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
        },
      ],
    ]);
    expect([...h.secrets.values().keys()]).toEqual(['secret-2']);
    expect(keptTokensIn(h)).toHaveLength(1);
    expect(JSON.stringify(facts)).not.toContain(consented.code);
  });
});

describe('the scope of a finish', () => {
  it('records the scope the server granted beside the scope asked, which the credential keeps, where it is narrower', async () => {
    const fake = await served({ grantedScope: 'files.read' });
    const h = consentHarnessAt(fake, { way: { scope: 'files.read files.write' } });
    const link = await filesOf(h);

    await finishing(h, link, await consentedOf(h, link));

    expect(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id: link.id })).toMatchObject({
      output: { credential: { scope: 'files.read files.write' }, granted_scope: 'files.read' },
    });
  });

  it('is bound to its start and not to the 24 hours of the link, and closes the link', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);
    const consented = await consentedOf(h, link, '2026-10-16T13:55:00.000Z');

    const late = await finishing(h, link, consented, '2026-10-16T14:02:00.000Z');

    expect(late).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(await finishing(h, link, consented, '2026-10-16T14:03:00.000Z')).toMatchObject({ reason: 'not_found' });
  });
});

describe('a scope the server grants', () => {
  it('is recorded with its scopes separated by single spaces, and the org lists its connections after', async () => {
    const fake = await served({ grantedScope: 'files.read  files.list' });
    const h = consentHarnessAt(fake, { way: { scope: 'files.read files.list' } });
    const link = await filesOf(h);

    expect(await finishing(h, link, await consentedOf(h, link))).toMatchObject({
      output: { granted_scope: 'files.read files.list' },
    });
    expect(await h.call(operationNamed(h.operations, 'list_connections'), ada)).toMatchObject({ status: 'succeeded' });
  });

  it('is refused where it is empty, after the tokens are revoked, and the org lists its connections after', async () => {
    const fake = await served({ grantedScope: '' });
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);

    expect(await finishing(h, link, await consentedOf(h, link))).toMatchObject({
      reason: 'conflict',
      detail:
        'The authorization server of the connection files granted none of the scopes asked, so the connection is not connected; start again and allow them',
    });
    expect([keptTokensIn(h), revocationsAt(fake)]).toEqual([[], 1]);
    expect(await h.call(operationNamed(h.operations, 'list_connections'), ada)).toMatchObject({ status: 'succeeded' });
  });
});

describe('a scope the server grants that is not one, or that answers a way asking none', () => {
  it('is refused in its own words where it is not a scope, after the tokens are revoked', async () => {
    const fake = await served({ grantedScope: 'files."read"' });
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);

    expect(await finishing(h, link, await consentedOf(h, link))).toMatchObject({
      reason: 'conflict',
      detail:
        'The authorization server of the connection files granted a scope written with characters a scope does not hold, so it cannot be connected as it was added',
    });
    expect([keptTokensIn(h), revocationsAt(fake)]).toEqual([[], 1]);
  });

  it('records no scope where it is empty and the way asks none, and the connection is connected', async () => {
    const fake = await served({ grantedScope: '' });
    const h = consentHarnessAt(fake, { way: {} });
    const link = await filesOf(h);

    const finished = await finishing(h, link, await consentedOf(h, link));

    expect(finished).toMatchObject({ status: 'succeeded', output: { status: 'connected', granted_scope: null } });
    expect(finished).not.toHaveProperty('output.credential.scope');
    expect(revocationsAt(fake)).toBe(0);
  });
});

describe('a finish refused before the code is redeemed', () => {
  it('is refused for a state the consent was not started with, and for an issuer that is not the server’s', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);
    const consented = await consentedOf(h, link);

    expect([
      await finishing(h, link, { ...consented, state: 'another-state' }),
      await finishing(h, link, { ...consented, iss: 'https://elsewhere.example.com' }),
    ]).toMatchObject([
      {
        reason: 'invalid_input',
        issues: [{ pointer: '/state', detail: 'Expected the state the consent was started with' }],
      },
      {
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/iss',
            detail: `Expected the issuer of the authorization server of the connection, ${fake.origin}`,
          },
        ],
      },
    ]);
    expect(await finishing(h, link, consented)).toMatchObject({ status: 'succeeded' });
  });

  it('is refused as not found where no consent was started or its ten minutes are over, and forgets an ended one', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const unstarted = await filesOf(h);
    const consented = { code: 'code', state: 'state', iss: fake.origin };
    const ended = await added(h, { provider: 'files', name: 'files-ended' });
    const endedConsent = await consentedOf(h, ended);
    const noOpenConsent =
      'There is no open consent of the connection files: none was started, or it was started more than ten minutes ago';

    expect(await finishing(h, unstarted, consented)).toMatchObject({ reason: 'not_found', detail: noOpenConsent });
    expect(await finishing(h, ended, endedConsent, '2026-10-15T14:11:00.000Z')).toMatchObject({ reason: 'not_found' });
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('a finish whose verifier is gone', () => {
  it('is refused as not found', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);
    const consented = await consentedOf(h, link);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    expect(await finishing(h, link, consented)).toMatchObject({ reason: 'not_found' });
  });
});

describe('a finish whose code is refused', () => {
  it('answers the refusal at the code in the runtime’s words, and leaves the start open for another code', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);
    const { url } = await startedAt(h, link);
    const consented = await consentedAt(url);

    const refused = await finishing(h, link, { ...consented, code: 'a-code-nobody-issued' });

    expect(refused).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/code', detail: 'Expected a code the authorization server takes; it refused this one' }],
    });
    expect(await finishing(h, link, consented)).toMatchObject({ status: 'succeeded' });
  });
});

describe('a finish refused after the tokens exist', () => {
  it('revokes the tokens and forgets their row where the record is refused, as when the connection was removed meanwhile', async () => {
    const fake = await served();
    const removal: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const h = consentHarnessAt(fake, { beforeKeeping: () => removal.run() });
    const link = await filesOf(h);
    const consented = await consentedOf(h, link);
    removal.run = () => h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(await finishing(h, link, consented)).toMatchObject({ reason: 'not_found' });
    expect(keptTokensIn(h)).toEqual([]);
    expect(revocationsAt(fake)).toBe(1);
  });

  it('revokes the tokens where their value is past the bound of the store, in the words of the store', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake, { mostSecretCharacters: 100 });
    const link = await filesOf(h);

    expect(await finishing(h, link, await consentedOf(h, link))).toMatchObject({
      reason: 'conflict',
      detail: 'A secret to keep holds more than 100 characters',
    });
    expect(keptTokensIn(h)).toEqual([]);
    expect(revocationsAt(fake)).toBe(1);
  });

  it('revokes the tokens where keeping them dies rather than fails', async () => {
    const fake = await served();
    const keeping: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const h = consentHarnessAt(fake, { beforeKeeping: () => keeping.run() });
    const link = await filesOf(h);
    const consented = await consentedOf(h, link);
    keeping.run = () => Promise.reject(new Error('The store went away'));

    const died = await finishing(h, link, consented);

    expect(died).toMatchObject({ status: 'failed' });
    expect([keptTokensIn(h), revocationsAt(fake)]).toEqual([[], 1]);
  });
});

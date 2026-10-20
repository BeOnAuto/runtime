import { SecretRefused, type SecretStore } from '@on.auto/secrets';
import { custodianRefusal } from '@on.auto/secrets/testing';
import { consentedAt, gatedRequests, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { added, crm } from '../testing/additions.ts';
import { consentFake } from '../testing/consents.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import { operationsOver, sealedInMemory } from '../testing/sealed-connections.ts';
import { calledThrough, sealedConsentAt, type SealedHarness } from '../testing/sealed-consents.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Parameters<typeof consentFake>[0] = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

const StartedSchema = Schema.Struct({ output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String }) }) });

interface Link {
  readonly id: string;
  readonly token: string;
}

function linkOf({ id, token }: Link): Link {
  return { id, token };
}

async function consentedThrough(sealed: SealedHarness, link: Link) {
  const started = Schema.decodeUnknownSync(StartedSchema)(await calledThrough(sealed, 'start', linkOf(link)));
  return { ...linkOf(link), ...(await consentedAt(started.output.authorize.url)) };
}

function refusedTo({ custodian }: SealedHarness, act: string): string {
  return `The custodian of the key ${custodian.kid} refused to ${act} a data key: ${custodianRefusal}`;
}

async function typesOfTheFacts({ h }: SealedHarness): Promise<readonly string[]> {
  return (await h.facts()).map(({ type }) => type);
}

describe('a start whose verifier the secret store cannot keep now', () => {
  it('answers unavailable in the words of the store, records no start and keeps nothing', async () => {
    const sealed = sealedConsentAt(await served());
    const link = await added(sealed.h, { provider: 'files' });

    sealed.custodian.refuse();
    const refused = await calledThrough(sealed, 'start', linkOf(link));

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The consent of the connection files cannot be started now, since the runtime cannot keep its verifier: ${refusedTo(sealed, 'wrap')}`,
    });
    expect(await typesOfTheFacts(sealed)).not.toContain('connection_consent_started');
    expect(sealed.rows.kept()).toEqual([]);
  });
});

describe('a start whose client registration the secret store cannot read now', () => {
  it('answers unavailable in the words of the store, before the person is sent anywhere', async () => {
    const fake = await served({ dynamicRegistration: true });
    const sealed = sealedConsentAt(fake, { way: { clients: ['dynamic'] }, consenting: { registeredClients: [] } });
    const link = await added(sealed.h, { provider: 'files' });
    await calledThrough(sealed, 'start', linkOf(link));

    sealed.custodian.refuse();
    const refused = await calledThrough(sealed, 'start', linkOf(link));

    expect(refused).toMatchObject({
      reason: 'unavailable',
      detail: `The client the runtime registered for the connection files cannot be kept or read now: ${refusedTo(sealed, 'unwrap')}`,
    });
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
  });
});

function refusingToKeep(store: SecretStore): SecretStore {
  const tooLarge = new SecretRefused({ because: 'too_large', detail: 'A secret to keep holds more than 8 KiB' });
  return { ...store, keep: () => Effect.fail(tooLarge) };
}

describe('a start whose client registration the secret store refuses to keep', () => {
  it('answers conflict in the words of the refusal, since the registration will never be kept', async () => {
    const fake = await served({ dynamicRegistration: true });
    const sealed = sealedConsentAt(fake, {
      way: { clients: ['dynamic'] },
      consenting: { registeredClients: [] },
      registrations: refusingToKeep(sealedInMemory().store),
    });
    const link = await added(sealed.h, { provider: 'files' });

    const refused = await calledThrough(sealed, 'start', linkOf(link));

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The client the runtime registered for the connection files cannot be kept: A secret to keep holds more than 8 KiB',
    });
  });
});

describe('a finish whose verifier the secret store cannot read now', () => {
  it('answers unavailable in the words of the store and redeems nothing, so the same code finishes it once the store reads it again', async () => {
    const fake = await served();
    const sealed = sealedConsentAt(fake);
    const finishing = await consentedThrough(sealed, await added(sealed.h, { provider: 'files' }));

    sealed.custodian.refuse();
    const refused = await calledThrough(sealed, 'finish', finishing);
    const redeemedBefore = fake.tokenRequests();
    sealed.custodian.answer();
    const finished = await calledThrough(sealed, 'finish', finishing);

    expect(refused).toMatchObject({
      reason: 'unavailable',
      detail: `The consent of the connection files cannot be finished now, since the runtime cannot read its verifier; the same code may be tried again shortly: ${refusedTo(sealed, 'unwrap')}`,
    });
    expect(redeemedBefore).toBe(0);
    expect(finished).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
  });
});

describe('a finish whose tokens the secret store cannot keep now, once the code is redeemed', () => {
  it('answers unavailable in the words of the store, says the person starts again, revokes the tokens and connects nothing', async () => {
    const fake = await served();
    const gate = gatedRequests();
    const sealed = sealedConsentAt(fake, { consenting: { fetch: gate.fetch } });
    const finishing = await consentedThrough(sealed, await added(sealed.h, { provider: 'files' }));

    const refusing = calledThrough(sealed, 'finish', finishing);
    await vi.waitFor(() => {
      expect(gate.holding()).toBe(1);
    });
    sealed.custodian.refuse();
    gate.release();
    const refused = await refusing;

    expect(refused).toMatchObject({
      reason: 'unavailable',
      detail: `The tokens of the connection files cannot be kept now, and the code they were given for is spent, so the person starts the consent again: ${refusedTo(sealed, 'wrap')}`,
    });
    expect(fake.heard().filter(({ path }) => path === '/revoke')).toHaveLength(1);
    expect(await typesOfTheFacts(sealed)).not.toContain('connection_connected');
    expect(sealed.rows.kept()).toHaveLength(1);
  });
});

describe('a credential the secret store cannot keep now', () => {
  it('answers unavailable in the words of the store, keeps nothing and leaves the link open for the same credential', async () => {
    const h = harness();
    const { custodian, rows, store } = sealedInMemory();
    const giving = operationNamed(operationsOver(h, store), 'give_credential');
    const { id, token } = await added(h, crm);

    custodian.refuse();
    const refused = await h.call(giving, ada, { id, token, value: 'crm-api-key' });
    const keptWhileRefused = rows.kept().length;
    custodian.answer();
    const given = await h.call(giving, ada, { id, token, value: 'crm-api-key' });

    expect(refused).toMatchObject({
      reason: 'unavailable',
      detail: `The credential of the connection crm cannot be kept now, so the connection is not connected and its link stays open: The custodian of the key ${custodian.kid} refused to wrap a data key: ${custodianRefusal}`,
    });
    expect(keptWhileRefused).toBe(0);
    expect(given).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
  });
});

import type { LinkToOpen, Outcome, RegisteredPlainLanguage } from '@on.auto/operations';
import { drive, providersOf } from '@on.auto/providers/testing';
import { Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, notes, reconnecting, statusesOf, type Added } from '../testing/additions.ts';
import { consentFake } from '../testing/consents.ts';
import { connectedCrm } from '../testing/crm-connections.ts';
import { ada, harness, operationNamed, type Harness, loopbackPolicy } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function wordsOf(h: Harness, name: string): RegisteredPlainLanguage {
  const { registration } = operationNamed(h.operations, name);
  if (!('plainLanguage' in registration) || registration.plainLanguage === undefined) {
    throw new Error(`The operation ${name} has no words`);
  }
  return registration.plainLanguage;
}

function outputOf(outcome: Outcome): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

async function outcomeWords(h: Harness, name: string, input: Readonly<Record<string, unknown>>): Promise<string> {
  const outcome = await h.call(operationNamed(h.operations, name), ada, input);
  return wordsOf(h, name).outcome(outputOf(outcome), input);
}

function linkingOf(h: Harness) {
  const { registration } = operationNamed(h.operations, 'add_connection');
  return Option.getOrThrow(Option.fromNullishOr('link' in registration ? registration.link : undefined));
}

async function linkOf(h: Harness): Promise<LinkToOpen | undefined> {
  const outcome = await h.call(operationNamed(h.operations, 'add_connection'), ada, crm);
  return linkingOf(h).toOpen(outputOf(outcome));
}

async function outputAfterTheLink(h: Harness, { id, url }: Added, at?: string): Promise<unknown> {
  return outputOf(await h.call({ registration: linkingOf(h).answerAfter({ id, url }) }, ada, notes, at));
}

async function wordsAfterTheLink(h: Harness, link: Added, at?: string): Promise<string> {
  return wordsOf(h, 'add_connection').outcome(await outputAfterTheLink(h, link, at), notes);
}

describe('the words of adding a connection', () => {
  it('name what was added and never show the address of its link', async () => {
    const h = harness();
    const words = await outcomeWords(h, 'add_connection', notes);
    const link = await linkOf(h);

    expect(words).toContain('“notes”');
    expect(words).not.toContain(String(link?.url));
  });

  it("name the link for the provider's title where the connection was added from a provider", async () => {
    expect(
      await outcomeWords(harness(), 'add_connection', { provider: 'tracker', placeholders: { site: 'acme' } }),
    ).toContain('Tracker');
  });

  it('ask an agent to have the person open the link of the connection', async () => {
    const link = await linkOf(harness());

    expect(link?.message).toContain('“crm”');
    expect(link?.url).toMatch(/^https:\/\/studio\.on\.auto\/connect\?server=http%3A%2F%2Flocalhost%3A5555&org=acme&/u);
  });
});

describe('the words of adding an MCP server given by hand that signs people in itself', () => {
  it('name the host of its issuer, in the words and in the message of the link', async () => {
    const fake = await consentFake({ dynamicRegistration: true });
    closing.push(fake.close);
    const h = harness({ policy: loopbackPolicy });
    const byHand = { name: 'files', type: 'mcp', entry: { url: fake.url }, credential: { kind: 'authorization' } };
    const output = outputOf(await h.call(operationNamed(h.operations, 'add_connection'), ada, byHand));
    const { host } = new URL(fake.origin);

    expect([wordsOf(h, 'add_connection').outcome(output, byHand), linkingOf(h).toOpen(output)?.message]).toEqual([
      expect.stringContaining(host),
      expect.stringContaining(host),
    ]);
  });
});

describe('the words of adding a connection under the organization’s own OAuth client', () => {
  it('name the connection, in the words and in the message of the link', async () => {
    const h = harness({ providers: providersOf(drive) });
    const own = { provider: 'drive', credential: { kind: 'authorization', oauth_client: 'own' } };
    const output = outputOf(await h.call(operationNamed(h.operations, 'add_connection'), ada, own));

    expect([wordsOf(h, 'add_connection').outcome(output, own), linkingOf(h).toOpen(output)?.message]).toEqual([
      expect.stringContaining('“drive”'),
      expect.stringContaining('“drive”'),
    ]);
  });
});

describe('the words of the answer after the link of a connection', () => {
  it('differ for a connection approved, pending, expired, replaced by a newer link and cancelled, and are the words of adding it while its link lasts', async () => {
    const h = harness();
    const [approved, pending, replaced, cancelled] = [
      await added(h, notes),
      await added(h, { ...notes, name: 'notes-2' }),
      await added(h, { ...notes, name: 'notes-3' }),
      await added(h, { ...notes, name: 'notes-4' }),
    ];
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: approved.id, token: approved.token });
    await reconnecting(h, replaced.id);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: cancelled.id });
    const words = [
      await wordsAfterTheLink(h, approved),
      await wordsAfterTheLink(h, pending),
      await wordsAfterTheLink(h, pending, pending.expiresAt),
      await wordsAfterTheLink(h, replaced),
      await wordsAfterTheLink(h, cancelled),
    ].map((said) => said.replace(/notes(-\d)?/u, 'notes'));

    expect(new Set(words).size).toBe(words.length);
    expect(await wordsAfterTheLink(h, pending)).toBe(
      await outcomeWords(harness(), 'add_connection', { ...notes, name: 'notes-2' }),
    );
  });

  it('ask no agent to have the person open a link once there is none', async () => {
    const h = harness();
    const link = await added(h, notes);

    expect(linkingOf(h).toOpen(await outputAfterTheLink(h, link, link.expiresAt))).toBeUndefined();
  });
});

describe('the words of listing connections', () => {
  it('name each connection up to twenty, and count the rest', async () => {
    const h = harness();
    const empty = await outcomeWords(h, 'list_connections', {});
    await added(h, notes);
    const one = await outcomeWords(h, 'list_connections', {});
    await statusesOf(
      h,
      Array.from({ length: 21 }, (_, index) => ({ ...crm, name: `crm-${String(index)}` })),
    );
    const many = await outcomeWords(h, 'list_connections', {});

    expect([empty.includes('“'), one.includes('“notes”')]).toEqual([false, true]);
    expect([many.split('“').length - 1, many.includes('22'), many.includes(' 2 ')]).toEqual([20, true, true]);
  });
});

describe('the words of removing and reconnecting a connection', () => {
  it('name the connection, and differ for one that is connected', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const connected = await connectedCrm(h);
    const reconnected = await outcomeWords(h, 'reconnect_connection', { id });

    expect(await outcomeWords(h, 'remove_connection', { id })).toContain('“notes”');
    expect(reconnected).toContain('“notes”');
    expect((await outcomeWords(h, 'reconnect_connection', { id: connected })).replace('crm', 'notes')).not.toBe(
      reconnected,
    );
  });
});

describe('the words of a tool that could not do what it was asked', () => {
  it('name what it tried to do on', () => {
    const h = harness();

    expect([
      wordsOf(h, 'add_connection').attempt(notes),
      wordsOf(h, 'add_connection').attempt({ provider: 'tracker' }),
      wordsOf(h, 'reconnect_connection').attempt({ id: 'crm-id' }),
      wordsOf(h, 'remove_connection').attempt({ id: 'crm-id' }),
    ]).toEqual([
      expect.stringContaining('“notes”'),
      expect.stringContaining('“tracker”'),
      expect.stringContaining('“crm-id”'),
      expect.stringContaining('“crm-id”'),
    ]);
    expect(wordsOf(h, 'list_connections').attempt({})).toEqual(expect.any(String));
    expect(() => wordsOf(h, 'get_connection')).toThrow('The operation get_connection has no words');
    expect(() => wordsOf(h, 'read_link')).toThrow('The operation read_link has no words');
  });
});

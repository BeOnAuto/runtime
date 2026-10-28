import type { LinkToOpen, Outcome, RegisteredPlainLanguage, Succeeded } from '@on.auto/operations';
import { Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, notes, reconnecting, statusesOf, type Added } from '../testing/additions.ts';
import { consentFake } from '../testing/consents.ts';
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

function outputOf(outcome: Outcome<Succeeded>): unknown {
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
  it('say what was added, where the person approves it, and that the link is shown to them by a name, never as its address', async () => {
    expect(await outcomeWords(harness(), 'add_connection', notes)).toBe(
      'Added the connection “notes”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within 24 hours; shown to them as a link named “Approve the connection”, never as its address.',
    );
  });

  it("name the link for the provider's title where the connection was added from a provider", async () => {
    expect(
      await outcomeWords(harness(), 'add_connection', { provider: 'tracker', placeholders: { site: 'acme' } }),
    ).toBe(
      'Added the connection “tracker”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within 24 hours; shown to them as a link named “Approve the Tracker connection”, never as its address.',
    );
  });

  it('ask an agent to have the person open the link of the connection', async () => {
    const link = await linkOf(harness());

    expect(link?.message).toBe(
      'Open this page to approve the connection “crm”, and give its credential where it takes one, within 24 hours.',
    );
    expect(link?.url).toMatch(/^https:\/\/studio\.on\.auto\/connect\?server=http%3A%2F%2Flocalhost%3A5555&org=acme&/u);
  });
});

describe('the words of adding an MCP server given by hand that signs people in itself', () => {
  it('say the person signs in at the host of its issuer on the page, and ask an agent to have them open it to do so', async () => {
    const fake = await consentFake({ dynamicRegistration: true });
    closing.push(fake.close);
    const h = harness({ policy: loopbackPolicy });
    const byHand = { name: 'files', type: 'mcp', entry: { url: fake.url }, credential: { kind: 'authorization' } };
    const output = outputOf(await h.call(operationNamed(h.operations, 'add_connection'), ada, byHand));
    const { host } = new URL(fake.origin);

    expect(wordsOf(h, 'add_connection').outcome(output, byHand)).toBe(
      `Added the connection “files”. The person who added it approves it, and signs in at ${host}, on the page its link opens, within 24 hours; shown to them as a link named “Approve the connection”, never as its address.`,
    );
    expect(linkingOf(h).toOpen(output)?.message).toBe(
      `Open this page to approve the connection “files”, and sign in at ${host}, within 24 hours.`,
    );
  });
});

describe('the words of the answer after the link of a connection', () => {
  it('say it is connected and nothing is left to open, once the person approved it', async () => {
    const h = harness();
    const link = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: link.id, token: link.token });

    expect(await wordsAfterTheLink(h, link)).toBe('Connected the connection “notes”; nothing is left to open.');
  });

  it('say where the person approves it while its link lasts, and to reconnect it for a new link once it expired', async () => {
    const h = harness();
    const link = await added(h, notes);

    expect(await wordsAfterTheLink(h, link)).toBe(await outcomeWords(harness(), 'add_connection', notes));
    expect(await wordsAfterTheLink(h, link, link.expiresAt)).toBe(
      'The connection “notes” is pending, and its link is used up or expired, so nothing is left to open: reconnect it for a new link.',
    );
  });

  it('say a newer link replaced the one offered, which the person opens, where the connection was reconnected since', async () => {
    const h = harness();
    const link = await added(h, notes);
    await reconnecting(h, link.id);

    expect(await wordsAfterTheLink(h, link)).toBe(
      'The connection “notes” is pending, and a newer link, still open, replaced the one offered: the person who added it opens the newest, and reconnecting it would replace that one too.',
    );
  });

  it('say the person cancelled it and nothing is connected, once it was removed', async () => {
    const h = harness();
    const link = await added(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(await wordsAfterTheLink(h, link)).toBe(
      'The person cancelled the connection “notes” on the page, so it is removed and nothing is connected.',
    );
  });

  it('ask no agent to have the person open a link once there is none', async () => {
    const h = harness();
    const link = await added(h, notes);

    expect(linkingOf(h).toOpen(await outputAfterTheLink(h, link, link.expiresAt))).toBeUndefined();
  });
});

describe('the words of listing connections', () => {
  it('list them by name and status, and say when there is none', async () => {
    const h = harness();
    const empty = await outcomeWords(h, 'list_connections', {});
    await added(h, notes);
    const one = await outcomeWords(h, 'list_connections', {});
    await statusesOf(
      h,
      Array.from({ length: 21 }, (_, index) => ({ ...crm, name: `crm-${String(index)}` })),
    );

    expect([empty, one]).toEqual(['The org has no connection.', 'There is 1 connection: “notes”, pending.']);
    expect(await outcomeWords(h, 'list_connections', {})).toMatch(
      /^There are 22 connections: “crm-20”, pending, .* and 2 more\.$/u,
    );
  });
});

describe('the words of removing a connection', () => {
  it('say what was removed and that its credential is forgotten', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    expect(await outcomeWords(h, 'remove_connection', { id })).toBe(
      'Removed the connection “notes”. No playbook may use it, and its credential is forgotten.',
    );
  });
});

describe('the words of reconnecting a connection', () => {
  it('say a new link was given to it, that the link before it stops working, and where the person approves it, as the words of adding it say', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    expect(await outcomeWords(h, 'reconnect_connection', { id })).toBe(
      'Gave a new link to the connection “notes”; the link before it stops working. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within 24 hours; shown to them as a link named “Approve the connection”, never as its address.',
    );
  });
});

describe('the words of a tool that could not do what it was asked', () => {
  it('name what it tried to do', () => {
    const h = harness();

    expect([
      wordsOf(h, 'add_connection').attempt(notes),
      wordsOf(h, 'add_connection').attempt({ provider: 'tracker' }),
      wordsOf(h, 'list_connections').attempt({}),
      wordsOf(h, 'reconnect_connection').attempt({ id: 'crm-id' }),
      wordsOf(h, 'remove_connection').attempt({ id: 'crm-id' }),
    ]).toEqual([
      'add the connection “notes”',
      'connect the provider “tracker”',
      'list the connections',
      'reconnect the connection “crm-id”',
      'remove the connection “crm-id”',
    ]);
    expect(() => wordsOf(h, 'get_connection')).toThrow('The operation get_connection has no words');
    expect(() => wordsOf(h, 'read_link')).toThrow('The operation read_link has no words');
  });
});

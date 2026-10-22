import type { LinkToOpen, Outcome, RegisteredPlainLanguage, Succeeded } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { added, crm, notes, statusesOf } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

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

async function linkOf(h: Harness): Promise<LinkToOpen | undefined> {
  const { registration } = operationNamed(h.operations, 'add_connection');
  const outcome = await h.call({ registration }, ada, crm);
  return 'linkToOpen' in registration ? registration.linkToOpen?.(outputOf(outcome)) : undefined;
}

describe('the words of adding a connection', () => {
  it('say what was added, where the person approves it, and that the link is shown to them by a name, never as its address', async () => {
    expect(await outcomeWords(harness(), 'add_connection', notes)).toBe(
      'Added the connection “notes”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes; shown to them as a link named “Approve the connection”, never as its address.',
    );
  });

  it("name the link for the provider's title where the connection was added from a provider", async () => {
    expect(
      await outcomeWords(harness(), 'add_connection', { provider: 'tracker', placeholders: { site: 'acme' } }),
    ).toBe(
      'Added the connection “tracker”. The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes; shown to them as a link named “Approve the Tracker connection”, never as its address.',
    );
  });

  it('ask an agent to have the person open the link of the connection', async () => {
    const link = await linkOf(harness());

    expect(link?.message).toBe(
      'Open this page to approve the connection “crm”, and give its credential where it takes one, within ten minutes.',
    );
    expect(link?.url).toMatch(/^https:\/\/studio\.on\.auto\/connect\?server=http%3A%2F%2Flocalhost%3A5555&org=acme&/u);
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

describe('the words of a tool that could not do what it was asked', () => {
  it('name what it tried to do', () => {
    const h = harness();

    expect([
      wordsOf(h, 'add_connection').attempt(notes),
      wordsOf(h, 'add_connection').attempt({ provider: 'tracker' }),
      wordsOf(h, 'list_connections').attempt({}),
      wordsOf(h, 'remove_connection').attempt({ id: 'crm-id' }),
    ]).toEqual([
      'add the connection “notes”',
      'connect the provider “tracker”',
      'list the connections',
      'remove the connection “crm-id”',
    ]);
    expect(() => wordsOf(h, 'get_connection')).toThrow('The operation get_connection has no words');
    expect(() => wordsOf(h, 'read_link')).toThrow('The operation read_link has no words');
  });
});

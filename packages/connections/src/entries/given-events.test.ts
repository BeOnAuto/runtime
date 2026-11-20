import { throughItsTools } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { mostEventsBytes } from '../registry/connection-entry.ts';
import { added, adding, crm, issuesIn } from '../testing/additions.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import { givenAs, listingEntries, withPaths } from '../testing/ledgers-documents.ts';

const events = { destinations: [throughItsTools] };

const hookIdInThePath = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];

const hooksDocument = withPaths({
  '/entries': listingEntries,
  '/hooks': {
    post: {
      operationId: 'create_hook',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { project: { type: 'string' }, url: { type: 'string' }, secret: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  '/hooks/{id}': { delete: { operationId: 'delete_hook', parameters: hookIdInThePath } },
});

const withItsHooks = givenAs(hooksDocument, { events });

const crmWithItsHooks = {
  ...crm,
  entry: { ...crm.entry, allowed: ['search', 'create_hook', 'delete_hook'] },
  events,
};

function pointersOf(outcome: Parameters<typeof issuesIn>[0]): readonly string[] {
  return issuesIn(outcome).map(({ pointer }) => pointer);
}

describe('a server given by hand that says how its service sends', () => {
  it('is added with its events on the fact that it was added, and answered and listed with them as given', async () => {
    const h = harness();

    const answered = await adding(h, withItsHooks);
    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada);

    const [fact] = await h.facts();
    expect(fact?.data).toMatchObject({ provider: null, events });
    expect(answered).toMatchObject({ status: 'succeeded', output: { events } });
    expect(listed).toMatchObject({ output: { connections: [{ name: 'ledgers', events }] } });
  });

  it('takes, for an MCP server, tools its entry allows, and is added with them without asking the server', async () => {
    const h = harness();

    await added(h, crmWithItsHooks);

    const [fact] = await h.facts();
    expect(fact?.data).toMatchObject({ server_type: 'mcp', events });
  });
});

describe('the events of a server given by hand, refused', () => {
  it('where they name a tool the document does not declare or the entry does not allow, with nothing recorded', async () => {
    const h = harness();
    const unsubscribe = { ...throughItsTools.unsubscribe, tool: 'remove_hook' };
    const elsewhere = { destinations: [{ ...throughItsTools, unsubscribe }] };

    const undeclared = await adding(h, { ...withItsHooks, events: elsewhere });
    const unallowed = await adding(h, { ...crmWithItsHooks, entry: crm.entry });

    expect(pointersOf(undeclared)).toEqual(['/events/destinations/0/unsubscribe/tool']);
    expect(pointersOf(unallowed)).toEqual([
      '/events/destinations/0/subscribe/tool',
      '/events/destinations/0/unsubscribe/tool',
    ]);
    expect(await h.facts()).toEqual([]);
  });

  it('at each place their form is wrong, and whole where they are larger than they may be', async () => {
    const h = harness();
    const asAQueue = { destinations: [{ ...throughItsTools, type: 'queue' }] };
    const padded = {
      destinations: [{ ...throughItsTools, topic: `{{ with.project }}${' '.repeat(mostEventsBytes)}` }],
    };

    expect(pointersOf(await adding(h, { ...withItsHooks, events: asAQueue }))).toEqual(['/events/destinations/0/type']);
    expect(pointersOf(await adding(h, { ...withItsHooks, events: padded }))).toEqual(['/events']);
    expect(await h.facts()).toEqual([]);
  });

  it('beside the name of a provider, whose own entry says how its service sends', async () => {
    const h = harness();

    expect(pointersOf(await adding(h, { provider: 'tracker', placeholders: { site: 'acme' }, events }))).toEqual([
      '/events',
    ]);
  });
});

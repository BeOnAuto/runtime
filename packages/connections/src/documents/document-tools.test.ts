import { Ledger } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, crm } from '../testing/additions.ts';
import { acmeWriter, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { givenAs, ledgers, ledgersBase, listingEntries, textOf, withPaths } from '../testing/ledgers-documents.ts';
import { documentDecider, documentStreamOfOrg, keptTextOf } from './document-streams.ts';

interface Link {
  readonly id: string;
  readonly token: string;
}

function readingTheLink(h: Harness, { id, token }: Link) {
  return h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token });
}

function ledgerLosingItsDocuments(): MemoryLedger {
  const kept = memoryLedger();
  const keptNothing = memoryLedger();
  const service = Ledger.of({
    ...kept.service,
    load: (stream, fold) =>
      stream.includes('/connection-documents/')
        ? keptNothing.service.load(stream, fold)
        : kept.service.load(stream, fold),
  });
  return { ...kept, service, layer: Layer.succeed(Ledger, service) };
}

const remindingAndRemoving = withPaths({
  '/entries': listingEntries,
  '/entries/{id}/reminders': {
    post: {
      operationId: 'remind_of_entry',
      description: 'Sends a reminder of the entry to whoever owes it. Nothing is sent twice in a day.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
  },
  '/entries/{id}': {
    delete: {
      operationId: 'remove_entry',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
  },
});

describe('the link of an HTTP API given its OpenAPI document whole', () => {
  it('names each tool the kept document offers, by name, with the first sentence of what it does and its mark by its method, never the text', async () => {
    const h = harness();
    const link = await added(h, givenAs(remindingAndRemoving));

    const read = await readingTheLink(h, link);

    expect(read).toMatchObject({
      status: 'succeeded',
      output: {
        tools: [
          { name: 'list_entries', summary: 'Lists the entries of the ledger between two days.', mark: 'reads' },
          { name: 'remind_of_entry', summary: 'Sends a reminder of the entry to whoever owes it.', mark: 'acts' },
          { name: 'remove_entry', summary: '', mark: 'acts' },
        ],
      },
    });
    expect(JSON.stringify(read)).not.toMatch(/Nothing is sent twice|"info"|\/reminders/u);
  });

  it('names no tool where the document kept under its SHA-256 is not the one it was added with', async () => {
    const h = harness();
    const text = textOf(remindingAndRemoving);
    const other = textOf(withPaths({ '/notes': { get: { operationId: 'list_notes' } } }));
    const keeping = { text: other, by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };
    await Effect.runPromise(
      h.ledger.service.execute(documentStreamOfOrg('acme', keptTextOf(text).sha256), documentDecider, keeping),
    );
    const link = await added(h, givenAs(text));

    expect(await readingTheLink(h, link)).toMatchObject({ status: 'succeeded', output: { tools: null } });
  });

  it('names no tool where the document is not kept', async () => {
    const h = harness({ ledger: ledgerLosingItsDocuments() });
    const link = await added(h, ledgers);

    expect(await readingTheLink(h, link)).toMatchObject({ status: 'succeeded', output: { tools: null } });
  });

  it('names no tool where the runtime can no longer read the connection, as when a model provider takes its name', async () => {
    const ledger = memoryLedger();
    const link = await added(harness({ ledger }), ledgers);

    expect(await readingTheLink(harness({ ledger, modelProviders: ['ledgers'] }), link)).toMatchObject({
      status: 'succeeded',
      output: { tools: null },
    });
  });
});

describe('the link of any other connection', () => {
  it('leaves tools out', async () => {
    const h = harness();
    const link = await added(h, crm);

    const read = await readingTheLink(h, link);

    expect(read).toMatchObject({ status: 'succeeded' });
    expect(read).not.toHaveProperty('output.tools');
  });
});

describe('the tools the link of an HTTP API given its document whole names', () => {
  it('are those its entry allows, so they are as many as the connection can call, though the document offers more', async () => {
    const h = harness();
    const text = textOf(remindingAndRemoving);
    const link = await added(
      h,
      givenAs(text, { entry: { base_url: ledgersBase, document_text: text, allowed: ['list_entries'] } }),
    );

    const read = await readingTheLink(h, link);

    expect(read).toMatchObject({
      output: {
        document: { tool_count: 3 },
        tools: [{ name: 'list_entries', summary: 'Lists the entries of the ledger between two days.', mark: 'reads' }],
      },
    });
    expect(read).not.toHaveProperty('output.tools.1');
  });

  it('carry a summary in plain text: a control character as a space, and no bidirectional formatting character', async () => {
    const h = harness();
    const summary = 'Lists the\rentries ‮seirtne‬ of\u0007 the ⁦ledger⁩‏ between two days.';
    const link = await added(h, givenAs(withPaths({ '/entries': { get: { ...listingEntries.get, summary } } })));

    expect(await readingTheLink(h, link)).toMatchObject({
      output: {
        tools: [{ name: 'list_entries', summary: 'Lists the entries seirtne of  the ledger between two days.' }],
      },
    });
  });
});

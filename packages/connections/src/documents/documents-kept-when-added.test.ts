import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { mostConnectionsOfAnOrg } from '../registry/registry-decisions.ts';
import { adding, added } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { givenAs, ledgers, ledgersDocument, textOf, withPaths } from '../testing/ledgers-documents.ts';
import { ledgerGone, watchedLedger } from '../testing/watched-ledger.ts';
import { documentFold, documentStreamOfOrg, keptTextOf } from './document-streams.ts';

const text = textOf(ledgersDocument);

const { sha256, bytes } = keptTextOf(text);

const documentStream = documentStreamOfOrg('acme', sha256);

const connections = connectionsStreamOfOrg('acme');

function keptIn(h: Harness) {
  return Effect.runPromise(h.ledger.service.load(documentStream, documentFold));
}

function documentsNamedIn(facts: Awaited<ReturnType<Harness['facts']>>): readonly string[] {
  return facts.flatMap((fact) =>
    fact.type === 'connection_added' && fact.data.document !== undefined ? [fact.data.document.sha256] : [],
  );
}

const anotherText = textOf(withPaths({ '/notes': { get: { operationId: 'list_notes' } } }));

describe('the document an HTTP API is given in document_text, as the connection is added', () => {
  it('is kept first, in a stream of its own named by its SHA-256, and the record of the connection names it by that SHA-256, its size and its number of tools alone', async () => {
    const ledger = watchedLedger();
    const h = harness({ ledger });

    await added(h, ledgers);

    const [fact] = await h.facts();
    expect(ledger.asked().filter((asked) => asked.startsWith('execute '))).toEqual([
      `execute ${documentStream}`,
      `execute ${connections}`,
    ]);
    expect(ledger.asked().indexOf(`load ${connections}`)).toBeLessThan(
      ledger.asked().indexOf(`execute ${documentStream}`),
    );
    expect(await keptIn(h)).toEqual({ state: { text, sha256, bytes }, version: 1 });
    expect(fact?.data).toMatchObject({ document: { sha256, bytes, tool_count: 2 } });
    expect(JSON.stringify(await h.facts())).not.toContain('between two days');
  });

  it('is kept once however many connections are added with it, each record naming the one stream', async () => {
    const h = harness();

    await added(h, ledgers);
    await added(h, { ...ledgers, name: 'ledgers-eu' });

    expect([documentsNamedIn(await h.facts()), (await keptIn(h)).version]).toEqual([[sha256, sha256], 1]);
  });
});

describe('the document of an addition refused by the registry', () => {
  it('is not kept where the name is taken, refused before anything is kept', async () => {
    const h = harness();
    await added(h, ledgers);

    const refused = await adding(h, givenAs(anotherText));

    expect(refused).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'taken' });
    expect(h.ledger.streamNames()).not.toContain(documentStreamOfOrg('acme', keptTextOf(anotherText).sha256));
  });

  it('is not kept where the org holds the most connections it may, refused before anything is kept', async () => {
    const h = harness();
    await Array.from({ length: mostConnectionsOfAnOrg }, (_, index) => index).reduce<Promise<unknown>>(
      async (before, index) => {
        await before;
        return added(h, { ...ledgers, name: `ledgers-${index}` });
      },
      Promise.resolve(),
    );

    const refused = await adding(h, givenAs(anotherText, { name: 'ledgers-more' }));

    expect(refused).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'connections_full' });
    expect(h.ledger.streamNames()).not.toContain(documentStreamOfOrg('acme', keptTextOf(anotherText).sha256));
  });
});

describe('an addition whose record fails after its document is kept', () => {
  it('leaves a document that no connection names, which the addition asked again keeps no second time', async () => {
    const ledger = watchedLedger();
    const h = harness({ ledger });
    ledger.failNextAppendTo(connections);

    const failed = await adding(h, ledgers);
    const listedBetween = await h.call(operationNamed(h.operations, 'list_connections'), ada);
    const factsBetween = await h.facts();
    const again = await adding(h, ledgers);

    expect(failed).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(failed)).not.toContain(ledgerGone);
    expect([factsBetween, listedBetween]).toMatchObject([[], { output: { connections: [] } }]);
    expect(again).toMatchObject({ status: 'succeeded', output: { document: { sha256, bytes, tool_count: 2 } } });
    expect(await keptIn(h)).toEqual({ state: { text, sha256, bytes }, version: 1 });
  });
});

describe('the reads of connections that never read a document', () => {
  it('list and read a connection given its document whole from its record alone', async () => {
    const ledger = watchedLedger();
    const h = harness({ ledger });
    const { id } = await added(h, ledgers);
    const before = ledger.asked().length;

    await h.call(operationNamed(h.operations, 'list_connections'), ada);
    await h.call(operationNamed(h.operations, 'get_connection'), ada, { id });

    const read = ledger.asked().slice(before);
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((asked) => asked.includes('/connection-documents/'))).toEqual([]);
  });
});

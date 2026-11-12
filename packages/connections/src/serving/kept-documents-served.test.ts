import { memoryLedger } from '@on.auto/operations/testing';
import { playbookToolCalls } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentDecider, documentStreamOfOrg, keptTextOf } from '../documents/document-streams.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import {
  accessThrough,
  askingThrough,
  connected,
  documentOf,
  served,
  toolsThrough,
} from '../testing/described-apis.ts';
import { harness, loopbackPolicy, type Harness } from '../testing/harness.ts';
import { watchedLedger } from '../testing/watched-ledger.ts';
import type { ServingServices } from './serving-services.ts';

interface LosingDocuments {
  readonly registry: ServingServices['registry'];
  readonly found: () => void;
}

function losingDocuments(h: Harness): LosingDocuments {
  const reading = { lost: true };
  const keptNothing = memoryLedger().service;
  return {
    registry: {
      ...h.ledger.service,
      load: (stream, fold) =>
        reading.lost && stream.includes('/connection-documents/')
          ? keptNothing.load(stream, fold)
          : h.ledger.service.load(stream, fold),
    },
    found: () => {
      reading.lost = false;
    },
  };
}

const searching = { server: 'ledgers', tool: 'search', arguments: { query: 'acme' } };

describe('an HTTP API whose document is not where its record names it', () => {
  it('answers as failing, with nothing sent to its service, and is prepared again at its next use', async () => {
    const fake = await served();
    const h = harness({ policy: loopbackPolicy });
    await connected(h, fake, documentOf());
    const losing = losingDocuments(h);
    const tools = await toolsThrough(h, askingThrough(), { registry: losing.registry });

    const failing = await tools.call('execute_connection', searching);
    const seenWhileLost = fake.seen().length;
    losing.found();
    const called = await tools.call('execute_connection', searching);

    expect(failing).toMatchObject({
      status: 'rejected',
      detail:
        'The tool server ledgers could not be used: The OpenAPI document the connection ledgers was added with is not kept',
    });
    expect([seenWhileLost, called]).toMatchObject([0, { status: 'succeeded' }]);
  });

  it('is never served with a document whose text is not the one its record names by its SHA-256 and size', async () => {
    const fake = await served();
    const h = harness({ policy: loopbackPolicy });
    const text = documentOf();
    const other = documentOf({ description: 'Another text kept where the first was named.' });
    const keeping = { text: other, by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };
    await Effect.runPromise(
      h.ledger.service.execute(documentStreamOfOrg('acme', keptTextOf(text).sha256), documentDecider, keeping),
    );
    await connected(h, fake, text);

    const failing = await (await toolsThrough(h, askingThrough())).call('execute_connection', searching);

    expect(failing).toMatchObject({
      status: 'rejected',
      detail:
        'The tool server ledgers could not be used: The OpenAPI document kept for the connection ledgers is not the one it was added with',
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('the run check, the calls and the listings of an HTTP API given its document in document_text', () => {
  it('read its record through the one source of connections, its document read once, as the connection is first prepared', async () => {
    const fake = await served();
    const ledger = watchedLedger();
    const h = harness({ policy: loopbackPolicy, ledger });
    const text = documentOf();
    await connected(h, fake, text);
    const access = await accessThrough(h, askingThrough());
    const tools = playbookToolCalls(access);
    const readSince = (before: number) => ledger.asked().slice(before);

    const beforeTheCheck = ledger.asked().length;
    await Effect.runPromise(access.named({ org: 'acme', playbook: 'alpha' }, [{ server: 'ledgers', tool: 'search' }]));
    const beforeTheCall = ledger.asked().length;
    const called = await tools.call('execute_connection', searching);
    const beforeTheListing = ledger.asked().length;
    await tools.call('introspect', { server: 'ledgers', tool: 'search' });

    const record = `load ${connectionsStreamOfOrg('acme')}`;
    expect(called).toMatchObject({ status: 'succeeded' });
    expect([
      readSince(beforeTheCheck).slice(0, beforeTheCall - beforeTheCheck),
      readSince(beforeTheCall).slice(0, beforeTheListing - beforeTheCall),
      readSince(beforeTheListing),
    ]).toEqual([[record, `load ${documentStreamOfOrg('acme', keptTextOf(text).sha256)}`], [record], [record]]);
  });
});

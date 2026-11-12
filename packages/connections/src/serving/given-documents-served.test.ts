import { Buffer } from 'node:buffer';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askingThrough, connected, documentOf, elsewhere, served, toolsThrough } from '../testing/described-apis.ts';
import { harness, loopbackPolicy } from '../testing/harness.ts';

const DescribedSchema = Schema.Struct({ output: Schema.Struct({ description: Schema.String }) });

function descriptionIn(outcome: unknown): string {
  return Schema.decodeUnknownSync(DescribedSchema)(outcome).output.description;
}

describe('an HTTP API given its document in document_text, once connected', () => {
  it('is served from the document its fact keeps, its calls going to base_url alone, asking no address for its document', async () => {
    const fake = await served();
    const h = harness({ policy: loopbackPolicy });
    const asking = askingThrough();
    await connected(h, fake, documentOf());

    const called = await (
      await toolsThrough(h, asking)
    ).call('execute_connection', {
      server: 'ledgers',
      tool: 'search',
      arguments: { query: 'acme' },
    });

    expect(called).toMatchObject({ status: 'succeeded' });
    expect(fake.seen()).toMatchObject([{ method: 'GET', path: '/v1/search', query: '?query=acme' }]);
    expect(fake.documentReads()).toBe(0);
    expect(asking.asked().every((url) => url.startsWith(fake.baseUrl))).toBe(true);
  });
});

describe('the calls of an HTTP API given its document in document_text', () => {
  it('follow no redirect its service answers a call with, sending nothing where it points', async () => {
    const fake = await served();
    const h = harness({ policy: loopbackPolicy });
    const asking = askingThrough();
    await connected(h, fake, documentOf());
    fake.answerNextWith({ status: 302, headers: { location: `${elsewhere}/v1/search` } });

    const called = await (
      await toolsThrough(h, asking)
    ).call('execute_connection', {
      server: 'ledgers',
      tool: 'search',
      arguments: { query: 'acme' },
    });

    expect(called).toMatchObject({
      status: 'succeeded',
      output: {
        outcome: 'tool_error',
        text: 'The tool server answered a redirect, HTTP 302, which a call does not follow',
      },
    });
    expect(asking.asked().filter((url) => url.startsWith(elsewhere))).toEqual([]);
  });

  it('show a model their words cut to the bound of any tool', async () => {
    const fake = await served();
    const h = harness({ policy: loopbackPolicy });
    await connected(h, fake, documentOf({ description: 'The rows that match. '.repeat(400) }));

    const described = await (
      await toolsThrough(h, askingThrough())
    ).call('introspect', {
      server: 'ledgers',
      tool: 'search',
    });

    expect(Buffer.byteLength(descriptionIn(described))).toBe(4_096);
  });
});

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { fetchWithin } from '../index.ts';

const SentInitSchema = Schema.Struct({
  redirect: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
});

interface Sent {
  readonly address: unknown;
  readonly init: typeof SentInitSchema.Type;
}

function recording() {
  const sent: Sent[] = [];
  const fetch = (address: unknown, init?: unknown): Promise<Response> => {
    sent.push({ address, init: Schema.decodeUnknownSync(SentInitSchema)(init) });
    return Promise.resolve(new Response('answered'));
  };
  return { sent, fetch };
}

function everywhere(): string | undefined {
  return undefined;
}

const rule = 'This fetch may not reach the host elsewhere.example.org, since it reaches *.example.com alone';

describe('a fetch held within the hosts it may reach', () => {
  it('sends to the address of a string or a URL, with the fields given, and follows no redirect', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, everywhere);

    await within('https://graph.example.com/mcp', { method: 'POST', redirect: 'follow' });
    await within(new URL('https://graph.example.com/url'));

    expect(sent).toEqual([
      { address: 'https://graph.example.com/mcp', init: { method: 'POST', redirect: 'manual' } },
      { address: 'https://graph.example.com/url', init: { redirect: 'manual' } },
    ]);
  });

  it('sends nothing to an address the rules do not allow, and fails with the rule, as they answer it later', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, () => Promise.resolve(rule));

    await expect(within('https://elsewhere.example.org/mcp')).rejects.toMatchObject({ _tag: 'host_refused', rule });
    expect(sent).toEqual([]);
  });

  it('sends to an address the rules allow later', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, () => Promise.resolve(everywhere()));

    await within('https://graph.example.com/mcp');

    expect(sent).toEqual([{ address: 'https://graph.example.com/mcp', init: { redirect: 'manual' } }]);
  });

  it('sends nothing to an address the rules do not allow, and fails with the rule', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, () => rule);

    await expect(within('https://elsewhere.example.org/mcp')).rejects.toMatchObject({ _tag: 'host_refused', rule });
    expect(sent).toEqual([]);
  });
});

describe('what travels beside a request through a fetch held within the hosts it may reach', () => {
  it('hands on what travels beside a request as it came, and nothing beside one that carries nothing', async () => {
    const beside: (readonly unknown[])[] = [];
    const within = fetchWithin((_address: string, _init: unknown, ...given: readonly [{ readonly mark: string }?]) => {
      beside.push(given);
      return Promise.resolve(new Response('answered'));
    }, everywhere);

    await within('https://graph.example.com/mcp', {}, { mark: 'kept' });
    await within('https://graph.example.com/mcp');

    expect(beside).toEqual([[{ mark: 'kept' }], []]);
  });
});

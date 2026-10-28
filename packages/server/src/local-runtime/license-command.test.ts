import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { licenseCommandOf } from './license-command.ts';
import type { RuntimeFetch } from './runtime-probe.ts';

const runningStatus = {
  version: '0.9.1',
  pid: 4242,
  started_at: '2026-10-14T09:41:07.000Z',
  started_by: 'terminal',
  directory: '/home/ada/playbooks',
  runs_in_flight: 0,
};

const key = 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0';

const allocation = { payload: 'eyJ2IjoxfQ', signature: 'c2lnbmVk', kid: 'auto-2026-10' };

interface Asked {
  readonly code: number;
  readonly logged: readonly string[];
  readonly errors: readonly string[];
  readonly sent: readonly (readonly [string, string | undefined])[];
}

async function ranWith(args: readonly string[], answer: () => Promise<Response>): Promise<Asked> {
  const logged: string[] = [];
  const errors: string[] = [];
  const sent: (readonly [string, string | undefined])[] = [];
  const fetch: RuntimeFetch = (address, { method, body }) => {
    sent.push([address, body]);
    return method === 'GET' ? Promise.resolve(Response.json(runningStatus)) : answer();
  };
  const [verb = '', given = ''] = args;
  const command = licenseCommandOf(args.length + 1, verb, given);
  const console = {
    log: (line: string) => {
      logged.push(line);
    },
    error: (line: string) => {
      errors.push(line);
    },
  };
  const code = await Effect.runPromise(command?.(5555, { fetch, console }) ?? Effect.succeed(-1));
  return { code, logged, errors, sent };
}

const licensed = { installation: '0199a3c4', org: 'acme', plan: 'free', expires_at: '2026-11-03T12:00:00.000Z' };

describe('auto-runtime license activate, for an org Auto names', () => {
  it('says the name of the org it is licensed to where the runtime gives one, and its id where it gives none', async () => {
    const named = await ranWith(['activate', key], () =>
      Promise.resolve(Response.json({ ...licensed, org_name: 'Acme Corporation' })),
    );
    const unnamed = await ranWith(['activate', key], () =>
      Promise.resolve(Response.json({ ...licensed, org_name: null })),
    );
    const blank = await ranWith(['activate', key], () =>
      Promise.resolve(Response.json({ ...licensed, org_name: '  ' })),
    );
    const unruly = await ranWith(['activate', key], () =>
      Promise.resolve(Response.json({ ...licensed, org_name: '\u001B[2JAcme\r\nCorporation\u202E' })),
    );

    expect([named.logged, unnamed.logged, blank.logged, unruly.logged]).toEqual([
      ['Licensed to Acme Corporation (free plan) until 2026-11-03; renews daily. Runtime id 0199a3c4.'],
      ['Licensed to acme (free plan) until 2026-11-03; renews daily. Runtime id 0199a3c4.'],
      ['Licensed to acme (free plan) until 2026-11-03; renews daily. Runtime id 0199a3c4.'],
      ['Licensed to [2JAcme Corporation (free plan) until 2026-11-03; renews daily. Runtime id 0199a3c4.'],
    ]);
  });
});

describe('auto-runtime license activate', () => {
  it('sends the key to the runtime running on this computer and says what it is licensed to', async () => {
    const asked = await ranWith(['activate', key], () => Promise.resolve(Response.json(licensed)));

    expect(asked).toEqual({
      code: 0,
      logged: ['Licensed to acme (free plan) until 2026-11-03; renews daily. Runtime id 0199a3c4.'],
      errors: [],
      sent: [
        ['http://127.0.0.1:5555/runtime', undefined],
        ['http://127.0.0.1:5555/v1/orgs/local/license', JSON.stringify({ key })],
      ],
    });
  });

  it.each([
    [
      'a refusal, in its words',
      () => Promise.resolve(Response.json({ detail: 'The key is revoked' }, { status: 409 })),
      'Auto Runtime did not activate the key: The key is revoked',
    ],
    [
      'an answer without words, by its status',
      () => Promise.resolve(new Response('Not found', { status: 404 })),
      'Auto Runtime did not activate the key: It answered 404',
    ],
    [
      'no answer at all',
      () => Promise.reject(new TypeError('fetch failed')),
      'Auto Runtime did not activate the key: Auto Runtime did not answer: TypeError: fetch failed',
    ],
  ])('tells %s, and fails', async (_, answer, said) => {
    const asked = await ranWith(['activate', key], answer);

    expect([asked.code, asked.errors]).toEqual([1, [said]]);
  });
});

describe('auto-runtime license allocation and report', () => {
  it('gives the runtime the allocation as its JSON, and says what it holds', async () => {
    const holds = {
      allocation: 'a1',
      installation: 'i1',
      credits: 50,
      spent: 0,
      refresh_by: '2026-11-03T12:00:00.000Z',
    };
    const asked = await ranWith(['allocation', JSON.stringify(allocation)], () =>
      Promise.resolve(Response.json(holds)),
    );

    expect(asked.sent.at(-1)).toEqual([
      'http://127.0.0.1:5555/v1/orgs/local/license/allocation',
      JSON.stringify({ allocation }),
    ]);
    expect(asked.logged).toEqual(['Offline credits: 0 of 50 used, usable until 2026-11-03.']);
  });

  it('refuses what is not the JSON of an allocation without asking the runtime', async () => {
    const asked = await ranWith(['allocation', 'not json'], () => Promise.resolve(Response.json({})));

    expect([asked.code, asked.sent, asked.errors[0]]).toEqual([
      1,
      [],
      expect.stringContaining('given whole as one argument'),
    ]);
  });

  it('prints the next signed report as the JSON an owner uploads in Studio', async () => {
    const made = { report: { allocation: 'a1', sequence: 1 }, signature: 'f00d' };
    const asked = await ranWith(['report'], () => Promise.resolve(Response.json(made)));

    expect([asked.code, asked.logged, asked.sent.at(-1)]).toEqual([
      0,
      [JSON.stringify(made)],
      ['http://127.0.0.1:5555/v1/orgs/local/license/allocation/report', '{}'],
    ]);
  });

  it('is no command of another shape', () => {
    expect([licenseCommandOf(2, 'activate', ''), licenseCommandOf(3, 'report', 'x')]).toEqual([undefined, undefined]);
  });
});

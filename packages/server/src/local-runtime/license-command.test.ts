import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runLicenseActivation } from './license-command.ts';
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

interface Asked {
  readonly code: number;
  readonly logged: readonly string[];
  readonly errors: readonly string[];
  readonly bodies: readonly (string | undefined)[];
}

async function activatedWith(answer: () => Promise<Response>): Promise<Asked> {
  const logged: string[] = [];
  const errors: string[] = [];
  const bodies: (string | undefined)[] = [];
  const fetch: RuntimeFetch = (_address, { method, body }) => {
    bodies.push(body);
    return method === 'GET' ? Promise.resolve(Response.json(runningStatus)) : answer();
  };
  const code = await Effect.runPromise(
    runLicenseActivation(key, 5555, {
      fetch,
      console: {
        log: (line) => {
          logged.push(line);
        },
        error: (line) => {
          errors.push(line);
        },
      },
    }),
  );
  return { code, logged, errors, bodies };
}

const licensed = { installation: '0199a3c4', org: 'acme', plan: 'free', expires_at: '2026-11-03T12:00:00.000Z' };

describe('auto-runtime license activate', () => {
  it('sends the key to the runtime running on this computer and says what it is licensed to', async () => {
    const asked = await activatedWith(() => Promise.resolve(Response.json(licensed)));

    expect(asked).toEqual({
      code: 0,
      logged: [
        'Auto Runtime is licensed to the org acme on the plan free, as the installation 0199a3c4, until 2026-11-03T12:00:00.000Z; it renews the license every day',
      ],
      errors: [],
      bodies: [undefined, JSON.stringify({ key })],
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
    const asked = await activatedWith(answer);

    expect([asked.code, asked.errors]).toEqual([1, [said]]);
  });
});

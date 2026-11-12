import { serveFakeApi, type FakeApiServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, fakeApiDocument, patientTiming, playbookToolCalls } from '@on.auto/tool-servers/testing';
import { onTestFinished } from 'vitest';

import type { ServingServices } from '../serving/serving-services.ts';
import { added } from './additions.ts';
import { ada, loopbackPolicy, operationNamed, type Harness } from './harness.ts';
import { sourceOver } from './served-connections.ts';

const key = 'ledgers-key-7c41e9a0';

export const elsewhere = 'https://elsewhere.example.com';

export interface Asking {
  readonly fetch: typeof globalThis.fetch;
  readonly asked: () => readonly string[];
}

export function askingThrough(): Asking {
  const asked: string[] = [];
  return {
    fetch: (...[address, init]: readonly [unknown, unknown?]) => {
      const request = new Request(String(address), Object.assign({}, init));
      asked.push(request.url);
      return globalThis.fetch(request);
    },
    asked: () => [...asked],
  };
}

export async function served(): Promise<FakeApiServer> {
  const fake = await serveFakeApi({ key, declaresKey: false });
  onTestFinished(fake.close);
  return fake;
}

export function documentOf(descriptions: Readonly<Record<string, string>> = {}): string {
  const written = fakeApiDocument('3.1', `${elsewhere}/v1`, false);
  return JSON.stringify({
    ...written,
    paths: {
      '/search': {
        get: {
          operationId: 'search',
          summary: 'Finds the rows of the graph that match a query.',
          parameters: [{ name: 'query', in: 'query', required: true, schema: { type: 'string' } }],
          ...descriptions,
        },
      },
    },
  });
}

export async function connected(h: Harness, fake: FakeApiServer, text: string): Promise<string> {
  const { id, token } = await added(h, {
    name: 'ledgers',
    type: 'openapi',
    entry: { base_url: fake.baseUrl, document_text: text },
    credential: {
      kind: 'secret',
      name: 'X-Api-Key',
      in: 'header',
      instructions: 'Make a key under [Settings, API keys](https://ledgers.example.com/settings/keys).',
      key_page: 'https://ledgers.example.com/settings/keys',
    },
  });
  await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: key });
  return id;
}

export async function accessThrough(h: Harness, asking: Asking, changes: Partial<ServingServices> = {}) {
  const { access } = await describedAccess(
    {},
    {
      timing: patientTiming,
      connections: sourceOver(h, { policy: loopbackPolicy, ...changes }),
      fetch: asking.fetch,
    },
  );
  onTestFinished(access.close);
  return access;
}

export async function toolsThrough(h: Harness, asking: Asking, changes: Partial<ServingServices> = {}) {
  return playbookToolCalls(await accessThrough(h, asking, changes));
}

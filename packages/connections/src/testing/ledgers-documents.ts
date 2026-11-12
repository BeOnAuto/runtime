import type { Outcome } from '@on.auto/operations';

import { adding } from './additions.ts';
import { documentsOffTheLoopback } from './harness-services.ts';
import type { Harness } from './harness.ts';

export const ledgersKeyHelp = {
  instructions: 'Make a key under [Settings, API keys](https://ledgers.example.com/settings/keys).',
  key_page: 'https://ledgers.example.com/settings/keys',
} as const;

export const ledgersBase = 'https://api.ledgers.example.com/v1';

type Document = Readonly<Record<string, unknown>>;

export const listingEntries = {
  get: {
    operationId: 'list_entries',
    summary: 'Lists the entries of the ledger between two days.',
    parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date' } }],
  },
};

export const ledgersDocument: Document = {
  openapi: '3.1.0',
  info: { title: 'Ledgers', version: '1' },
  servers: [{ url: 'https://elsewhere.example.com/v9' }],
  paths: {
    '/entries': listingEntries,
    '/entries/{id}': {
      delete: {
        operationId: 'remove_entry',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
  },
};

export function textOf(document: Document): string {
  return JSON.stringify(document);
}

export function givenAs(document: Document | string, changes: Readonly<Record<string, unknown>> = {}) {
  return {
    name: 'ledgers',
    type: 'openapi',
    entry: { base_url: ledgersBase, document_text: typeof document === 'string' ? document : textOf(document) },
    credential: { kind: 'secret', name: 'X-Ledgers-Key', in: 'header', ...ledgersKeyHelp },
    ...changes,
  } as const;
}

export const ledgers = givenAs(ledgersDocument);

export function withPaths(paths: Document): Document {
  return { ...ledgersDocument, paths };
}

interface Asked {
  readonly asked: () => readonly string[];
  readonly fetch: typeof globalThis.fetch;
}

export function askedThrough(): Asked {
  const asked: string[] = [];
  return {
    asked: () => [...asked],
    fetch: (...[address, init]: readonly [unknown, unknown?]) => {
      asked.push(String(address));
      return documentsOffTheLoopback(String(address), Object.assign({}, init));
    },
  };
}

export function refusedAt(
  pointer: string,
  detail: unknown,
): readonly [{ readonly pointer: string; readonly detail: unknown }] {
  return [{ pointer, detail }];
}

interface Recorded {
  readonly outcome: Outcome;
  readonly facts: number;
}

export async function recordedAfter(h: Harness, input: unknown): Promise<Recorded> {
  const outcome = await adding(h, input);
  return { outcome, facts: (await h.facts()).length };
}

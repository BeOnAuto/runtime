import { sha256Of, textToKeep } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookContext, type PlaybookAddress } from '../caller/playbook-context.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import type { Ledger } from './ledger.ts';
import { playbookLedgerOf } from './playbook-ledger.ts';
import { playbookPayloadReader } from './playbook-reader.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const gamma = { org: 'globex', playbook: 'gamma' };

const text = '{"query":"x"}';

const kept = { sha256: sha256Of(text), bytes: 13 };

function payloadReadIn(service: Ledger['Service'], address: PlaybookAddress) {
  const read = Effect.flatMap(playbookPayloadReader, (payloads) => Effect.flip(payloads.json(kept)));
  return Effect.runPromise(
    read.pipe(
      Effect.catch((value) => Effect.succeed(value)),
      Effect.provideContext(playbookLedgerOf(service, address)),
      Effect.provideService(PlaybookContext, address),
    ),
  );
}

describe('the reader of the payloads of the playbook of a call', () => {
  it('reads a payload that playbook keeps, and finds missing one that only another playbook keeps', async () => {
    const { service } = memoryLedger();
    await Effect.runPromise(service.content.put(gamma, textToKeep(text, 'application/json')));

    expect([await payloadReadIn(service, gamma), await payloadReadIn(service, alpha)]).toMatchObject([
      { query: 'x' },
      { _tag: 'payload_missing', org: 'acme', playbook: 'alpha', sha256: kept.sha256, because: 'not_held' },
    ]);
  });

  it('reads the head of that playbook, so a payload whose bytes are not found within the hour of its put may yet be read', async () => {
    const store = memoryContentStore();
    const { service } = memoryLedger(undefined, [], undefined, { ...store, read: () => Effect.undefined });
    await Effect.runPromise(service.content.put(alpha, textToKeep(text, 'application/json')));

    expect(await payloadReadIn(service, alpha)).toMatchObject({ _tag: 'unavailable' });
  });
});

import { sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookContext } from '../caller/playbook-context.ts';
import { PayloadOffloading } from '../payloads/payload-texts.ts';
import { PayloadsShared, sharedPayloadsWithin } from '../payloads/shared-payloads.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookLedgerOf } from './playbook-ledger.ts';
import { playbookPayloadKept } from './playbook-writer.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const text = '{"query":"x"}';

const toKeep = { sha256: sha256Of(text), bytes: 13, text, mediaType: 'application/json' };

async function heldAfterAPut(outside: boolean): Promise<string | undefined> {
  const shared = sharedPayloadsWithin(1024);
  const { service } = memoryLedger();
  await Effect.runPromise(
    playbookPayloadKept(toKeep).pipe(
      Effect.provideContext(playbookLedgerOf(service, alpha)),
      Effect.provideService(PlaybookContext, alpha),
      Effect.provideService(PayloadsShared, shared),
      Effect.provideService(PayloadOffloading, outside),
    ),
  );
  return shared.cache.textOf(alpha, toKeep.sha256);
}

describe('the writer of the payloads of the playbook of a call, given the payloads its process shares', () => {
  it('holds a payload it kept in the set its process shares whatever the switch, which only its callers read', async () => {
    expect([await heldAfterAPut(false), await heldAfterAPut(true)]).toEqual([text, text]);
  });
});

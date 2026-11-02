import type { ContentStore } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import type { Capability } from '@on.auto/definitions';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import {
  assets,
  assetsDue,
  assetTotals,
  makeGenerationFunctionAdapter,
  type AssetsDue,
  type GenerationPorts,
} from '../index.ts';
import { fakeGateway, type FakeGateway, type GatewayAnswering } from './gateway-fakes.ts';
import { callsOn, type HarnessCalls } from './harness-calls.ts';
import { readersOn, type HarnessReaders } from './harness-readers.ts';
import { testCatalog } from './test-catalog.ts';

export const harnessStartsAt = Date.parse('2026-11-01T10:00:00.000Z');

export interface HarnessOptions extends Partial<Omit<GenerationPorts, 'ledger' | 'content' | 'fetch'>> {
  readonly answering?: GatewayAnswering;
}

export interface GenerationHarness extends HarnessCalls, HarnessReaders {
  readonly ledger: MemoryLedger;
  readonly store: ContentStore;
  readonly gateway: FakeGateway;
  readonly capability: Capability;
  readonly due: AssetsDue;
  readonly expireAt: (now: number) => Promise<number>;
  readonly passes: (milliseconds: number) => void;
}

export function generationHarness({ answering, ...given }: HarnessOptions = {}): GenerationHarness {
  const store = memoryContentStore();
  const ledger = memoryLedger(undefined, [assets, assetTotals], undefined, store);
  const gateway = fakeGateway(answering);
  const time = { now: harnessStartsAt };
  const capability = makeGenerationFunctionAdapter({
    catalog: testCatalog,
    gateways: [gateway.settings],
    ownKey: true,
    ...given,
    fetch: gateway.fetch,
    ledger: ledger.service,
    content: ledger.service.content,
  });
  const due = assetsDue({ ledger: ledger.service });
  return {
    ledger,
    store,
    gateway,
    capability,
    due,
    ...callsOn(ledger, capability, () => time.now),
    ...readersOn(ledger),
    expireAt: async (now) => {
      const items = await Effect.runPromise(due.due(now, 256, false));
      await Effect.runPromise(Effect.forEach(items, (item) => item.perform(now), { discard: true }));
      return items.length;
    },
    passes: (milliseconds) => {
      time.now += milliseconds;
    },
  };
}

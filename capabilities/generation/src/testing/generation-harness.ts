import type { ContentStore } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import type { Capability } from '@on.auto/definitions';
import { contentHoldersOf } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';

import {
  AssetEventSchema,
  assets,
  assetsDue,
  assetTotals,
  generationsDue,
  generationsWaiting,
  makeGenerationFunctionAdapter,
  type AssetsDue,
  type GenerationPorts,
  type GenerationsDue,
} from '../index.ts';
import { fakeGateway, type FakeGateway, type GatewayAnswering } from './gateway-fakes.ts';
import { callsOn, performedAt, type HarnessCalls } from './harness-calls.ts';
import { readersOn, type HarnessReaders } from './harness-readers.ts';
import { testCatalog } from './test-catalog.ts';

export const harnessStartsAt = Date.parse('2026-11-01T10:00:00.000Z');

export interface HarnessOptions extends Partial<Omit<GenerationPorts, 'ledger' | 'content' | 'fetch'>> {
  readonly answering?: GatewayAnswering;
  readonly clockStepMs?: number;
}

export interface GenerationHarness extends HarnessCalls, HarnessReaders {
  readonly ledger: MemoryLedger;
  readonly store: ContentStore;
  readonly gateway: FakeGateway;
  readonly capability: Capability;
  readonly due: AssetsDue;
  readonly waiting: GenerationsDue;
  readonly expireAt: (now: number) => Promise<number>;
  readonly pollAt: (now: number) => Promise<number>;
  readonly endAt: (now: number) => Promise<number>;
  readonly passes: (milliseconds: number) => void;
}

export function generationHarness({ answering, clockStepMs = 0, ...given }: HarnessOptions = {}): GenerationHarness {
  const store = memoryContentStore();
  const ledger = memoryLedger(
    undefined,
    [assets, assetTotals, generationsWaiting],
    contentHoldersOf([AssetEventSchema]),
    store,
  );
  const gateway = fakeGateway(answering);
  const time = { now: harnessStartsAt };
  const ports = {
    catalog: testCatalog,
    gateways: [gateway.settings],
    ownKey: true,
    ...given,
    fetch: gateway.fetch,
    ledger: ledger.service,
    content: ledger.service.content,
  };
  const capability = makeGenerationFunctionAdapter(ports);
  const due = assetsDue({ ledger: ledger.service });
  const waiting = generationsDue(ports);
  return {
    ledger,
    store,
    gateway,
    capability,
    due,
    waiting,
    ...callsOn(ledger, capability, () => {
      time.now += clockStepMs;
      return time.now;
    }),
    ...readersOn(ledger),
    expireAt: (now) => performedAt(due, now, false),
    pollAt: (now) => performedAt(waiting, now, true),
    endAt: (now) => performedAt(waiting, now, false),
    passes: (milliseconds) => {
      time.now += milliseconds;
    },
  };
}

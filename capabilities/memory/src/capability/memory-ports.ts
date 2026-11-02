import { InvalidInput, randomUUIDv7, type Ledger } from '@on.auto/operations';
import { Effect } from 'effect';

import { memoryBounds } from '../document/memory-bounds.ts';
import { organizationNotKept } from '../document/memory-scopes.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';

export type MemoryLedger = Pick<
  Ledger['Service'],
  'load' | 'execute' | 'scrubFact' | 'readProjectedRows' | 'countProjectedRows'
>;

export interface MemoryFunctionAdapterOptions {
  readonly ledger: MemoryLedger;
  readonly mostKept?: number;
  readonly mostExamined?: number;
  readonly newId?: () => string;
  readonly organizationKept?: boolean;
}

export interface MemoryPorts {
  readonly ledger: MemoryLedger;
  readonly mostKept: number;
  readonly mostExamined: number;
  readonly newId: () => string;
  readonly organizationKept: boolean;
}

export function memoryPortsOf({
  ledger,
  mostKept = memoryBounds.mostKept,
  mostExamined = memoryBounds.mostExamined,
  newId = randomUUIDv7,
  organizationKept = true,
}: MemoryFunctionAdapterOptions): MemoryPorts {
  return { ledger, mostKept, mostExamined, newId, organizationKept };
}

export function keptHere(
  { organizationKept }: Pick<MemoryPorts, 'organizationKept'>,
  scope: MemoryScope,
  pointer: string,
): Effect.Effect<void, InvalidInput> {
  return organizationKept || scope === 'playbook'
    ? Effect.void
    : Effect.fail(
        new InvalidInput({ detail: organizationNotKept, issues: [{ pointer, detail: organizationNotKept }] }),
      );
}

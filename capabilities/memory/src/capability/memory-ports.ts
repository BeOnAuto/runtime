import { InvalidInput, randomUUIDv7 } from '@on.auto/operations';
import { Effect } from 'effect';

import { memoryBounds } from '../document/memory-bounds.ts';
import { organizationNotKept } from '../document/memory-scopes.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import type { MemoryAt, MemoryPlace } from '../facts/memory-streams.ts';
import { memoryKeeperOn } from '../keeper/kept-in-a-ledger.ts';
import type { MemoryKeeper, MemoryLedger } from '../keeper/memory-keeper.ts';

export interface MemoryFunctionAdapterOptions {
  readonly ledger: MemoryLedger;
  readonly organization?: MemoryKeeper;
  readonly mostKept?: number;
  readonly mostExamined?: number;
  readonly newId?: () => string;
}

export interface MemoryPorts {
  readonly kept: MemoryKeeper;
  readonly organization: MemoryKeeper | undefined;
  readonly mostExamined: number;
  readonly newId: () => string;
}

export function memoryPortsOf({
  ledger,
  organization,
  mostKept,
  mostExamined = memoryBounds.mostExamined,
  newId = randomUUIDv7,
}: MemoryFunctionAdapterOptions): MemoryPorts {
  return {
    kept: memoryKeeperOn({ ledger, ...(mostKept === undefined ? {} : { mostKept }) }),
    organization,
    mostExamined,
    newId,
  };
}

export function organizationKeeperOf({ kept, organization }: MemoryPorts): MemoryKeeper {
  return organization ?? kept;
}

export function keeperOf(
  ports: MemoryPorts,
  { playbook }: MemoryPlace,
  { place, scope }: Pick<MemoryAt, 'place' | 'scope'>,
): MemoryKeeper {
  return scope === 'playbook' && place.playbook === playbook ? ports.kept : organizationKeeperOf(ports);
}

export function organizationKept({ organization }: Pick<MemoryPorts, 'organization'>): boolean {
  return organization !== undefined;
}

export function keptHere(
  ports: Pick<MemoryPorts, 'organization'>,
  scope: MemoryScope,
  pointer: string,
): Effect.Effect<void, InvalidInput> {
  return organizationKept(ports) || scope === 'playbook'
    ? Effect.void
    : Effect.fail(
        new InvalidInput({ detail: organizationNotKept, issues: [{ pointer, detail: organizationNotKept }] }),
      );
}

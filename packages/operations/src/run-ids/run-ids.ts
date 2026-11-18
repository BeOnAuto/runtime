import { streamPrefixOfOrg } from '../ledger/bound-ports.ts';
import type { Conflict } from '../outcome/conflict.ts';
import { addressedStreamOf } from '../projections/keyed-projection.ts';

export interface RunIds {
  readonly types: readonly string[];
  readonly heldElsewhere: () => Conflict;
}

export interface RunIdInAnOrg {
  readonly orgKey: string;
  readonly runId: string;
}

export interface RunIdClaim extends RunIdInAnOrg {
  readonly definitionKey: string;
}

export interface FactOfAStream {
  readonly stream: string;
  readonly type: string;
  readonly position: number;
}

const runsKind = 'runs';

function runIdClaimOf({ types }: RunIds, { stream, type, position }: FactOfAStream): RunIdClaim | undefined {
  const named = addressedStreamOf(stream);
  if (named === undefined || named.scope !== 'definition' || named.kind !== runsKind) {
    return undefined;
  }
  return position === 1 && types.includes(type)
    ? { orgKey: streamPrefixOfOrg(named.address), runId: named.id, definitionKey: named.prefix }
    : undefined;
}

export function runIdClaimsOf(runIds: RunIds, facts: readonly FactOfAStream[]): readonly RunIdClaim[] {
  return facts.flatMap((fact) => {
    const claim = runIdClaimOf(runIds, fact);
    return claim === undefined ? [] : [claim];
  });
}

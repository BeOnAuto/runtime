import { Function } from 'effect';

import type { Conflict } from '../outcome/conflict.ts';
import {
  runIdClaimsOf,
  type FactOfAStream,
  type RunIdClaim,
  type RunIdInAnOrg,
  type RunIds,
} from '../run-ids/run-ids.ts';

type StagedRunIds = { readonly refused: Conflict } | { readonly commit: () => void };

export interface MemoryRunIds {
  readonly staged: (facts: readonly FactOfAStream[]) => StagedRunIds;
  readonly holderOf: (claimed: RunIdInAnOrg) => string | undefined;
}

const nothingToKeep: StagedRunIds = { commit: Function.constVoid };

function keyOf({ orgKey, runId }: RunIdInAnOrg): string {
  return JSON.stringify([orgKey, runId]);
}

export function memoryRunIds(runIds: RunIds | undefined): MemoryRunIds {
  const rows = new Map<string, RunIdClaim>();
  const heldElsewhere = (claim: RunIdClaim) => {
    const holder = rows.get(keyOf(claim));
    return holder !== undefined && holder.definitionKey !== claim.definitionKey;
  };
  return {
    staged: (facts) => {
      if (runIds === undefined) {
        return nothingToKeep;
      }
      const claims = runIdClaimsOf(runIds, facts);
      return claims.some((claim) => heldElsewhere(claim))
        ? { refused: runIds.heldElsewhere() }
        : {
            commit: () => {
              for (const claim of claims) {
                rows.set(keyOf(claim), rows.get(keyOf(claim)) ?? claim);
              }
            },
          };
    },
    holderOf: (claimed) => rows.get(keyOf(claimed))?.definitionKey,
  };
}

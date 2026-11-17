import type { GuideVariables } from '@on.auto/definitions';

import { computationBounds, mebibytes } from '../run/run-bounds.ts';

const fixedOnThisServer = 'are fixed on this server';

function inMebibytes(bytes: number): string {
  return `${bytes / mebibytes} MiB`;
}

export function guideVariablesOf({
  memoryBytes,
}: { readonly memoryBytes: number } = computationBounds): GuideVariables {
  return {
    'computation.most_memory': {
      value: inMebibytes(memoryBytes),
      default: inMebibytes(computationBounds.memoryBytes),
    },
    'computation.bounds_changed_by': { value: fixedOnThisServer, default: fixedOnThisServer },
  };
}

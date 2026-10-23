import { Ledger } from '@on.auto/operations';
import type { Timing } from '@on.auto/tool-servers';
import type { HostClock } from '@on.auto/workflow-host';
import { Context, Layer } from 'effect';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import type { ComposedServerOptions } from '../../server-options/composed-options.ts';

export type LedgerOver = (ledger: Ledger['Service']) => Ledger['Service'];

export interface ServedParts {
  readonly programPoolOf?: ProgramPoolOf;
  readonly clock?: HostClock;
  readonly toolTiming?: Timing;
  readonly ledgerOver?: LedgerOver;
}

export function composedWithTheLedgerOver(
  options: ComposedServerOptions,
  ledgerOver: LedgerOver,
): ComposedServerOptions {
  return {
    ...options,
    composed: async (settings, telemetry, shippedFiles) => {
      const composed = await options.composed(settings, telemetry, shippedFiles);
      const services = Layer.flatMap(composed.services, (served) =>
        Layer.succeedContext(Context.add(served, Ledger, ledgerOver(Context.get(served, Ledger)))),
      );
      return { ...composed, services };
    },
  };
}

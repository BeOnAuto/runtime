import { RunMeter, type Meter } from '@on.auto/definitions';
import type { Signers } from '@on.auto/meter';
import { Ledger } from '@on.auto/operations';
import type { LanguageModel } from '@on.auto/reasoning';
import type { Timing } from '@on.auto/tool-servers';
import type { HostClock } from '@on.auto/workflow-host';
import { Context, Layer } from 'effect';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import type { ComposedServerOptions } from '../../server-options/composed-options.ts';
import type { TemporaryLedger } from '../records/temporary-ledger.ts';

export type LedgerOver = (ledger: Ledger['Service']) => Ledger['Service'];

export interface ServedParts {
  readonly programPoolOf?: ProgramPoolOf;
  readonly clock?: HostClock;
  readonly toolTiming?: Timing;
  readonly ledgerOver?: LedgerOver;
  readonly admit?: LanguageModel['Service']['admit'];
  readonly ledger?: TemporaryLedger;
  readonly signers?: Signers;
  readonly meter?: Meter;
}

function composedWithTheLedgerOver(options: ComposedServerOptions, ledgerOver: LedgerOver): ComposedServerOptions {
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

function composedWithTheMeter(options: ComposedServerOptions, meter: Meter): ComposedServerOptions {
  return {
    ...options,
    composed: async (settings, telemetry, shippedFiles) => {
      const composed = await options.composed(settings, telemetry, shippedFiles);
      const services = Layer.flatMap(composed.services, (served) =>
        Layer.succeedContext(Context.add(served, RunMeter, meter)),
      );
      return { ...composed, services };
    },
  };
}

interface ComposedParts {
  readonly ledgerOver: LedgerOver | undefined;
  readonly meter: Meter | undefined;
}

export function composedWithTheParts(
  options: ComposedServerOptions,
  { ledgerOver, meter }: ComposedParts,
): ComposedServerOptions {
  const metered = meter === undefined ? options : composedWithTheMeter(options, meter);
  return ledgerOver === undefined ? metered : composedWithTheLedgerOver(metered, ledgerOver);
}

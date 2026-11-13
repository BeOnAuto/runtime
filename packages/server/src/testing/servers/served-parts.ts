import { RunMeter, type Meter } from '@on.auto/definitions';
import type { LicensedFeatures } from '@on.auto/meter';
import { Ledger } from '@on.auto/operations';
import type { LanguageModel } from '@on.auto/reasoning';
import { Context, Layer } from 'effect';

import type { CompositionParts } from '../../composition/composition-root.ts';
import type { ComposedServerOptions } from '../../server-options/composed-options.ts';
import type { TemporaryLedger } from '../records/temporary-ledger.ts';

export type LedgerOver = (ledger: Ledger['Service']) => Ledger['Service'];

type ShippedFiles = ComposedServerOptions['shippedFiles'];

type ShippedFilesOver = (files: ShippedFiles) => ShippedFiles;

export interface ServedParts {
  readonly programPoolOf?: NonNullable<CompositionParts['programPoolOf']>;
  readonly clock?: NonNullable<CompositionParts['clock']>;
  readonly toolTiming?: NonNullable<CompositionParts['toolTiming']>;
  readonly ledgerOver?: LedgerOver;
  readonly admit?: LanguageModel['Service']['admit'];
  readonly ledger?: TemporaryLedger;
  readonly signers?: NonNullable<CompositionParts['signers']>;
  readonly meter?: Meter;
  readonly installed?: NonNullable<CompositionParts['installed']>;
  readonly features?: Layer.Layer<LicensedFeatures>;
  readonly shippedFilesOver?: ShippedFilesOver;
  readonly keptOutside?: boolean;
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
  readonly shippedFilesOver: ShippedFilesOver | undefined;
}

export function offloadingSetBy(keptOutside: boolean | undefined): Readonly<Record<string, string>> {
  return keptOutside === undefined ? {} : { PAYLOAD_OFFLOADING: String(keptOutside) };
}

export function composedWithTheParts(
  options: ComposedServerOptions,
  { ledgerOver, meter, shippedFilesOver }: ComposedParts,
): ComposedServerOptions {
  const shipped =
    shippedFilesOver === undefined ? options : { ...options, shippedFiles: shippedFilesOver(options.shippedFiles) };
  const metered = meter === undefined ? shipped : composedWithTheMeter(shipped, meter);
  return ledgerOver === undefined ? metered : composedWithTheLedgerOver(metered, ledgerOver);
}

import { RunMeter, type Meter } from '@on.auto/definitions';
import type { LicensedFeatures } from '@on.auto/meter';
import { DecisionPointPatience, Ledger } from '@on.auto/operations';
import type { LanguageModel } from '@on.auto/reasoning';
import { Clock, Context, Layer } from 'effect';

import type { CompositionParts } from '../../composition/composition-root.ts';
import type { ComposedServerOptions } from '../../server-options/composed-options.ts';
import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import { effectClockOn, type SteppedServerClock } from '../waiting/stepped-server-clock.ts';
import { longerThanTheTestMs } from '../waiting/until.ts';

export type LedgerOver = (ledger: Ledger['Service']) => Ledger['Service'];

type ShippedFiles = ComposedServerOptions['shippedFiles'];

type ShippedFilesOver = (files: ShippedFiles) => ShippedFiles;

export interface ServedParts {
  readonly programPoolOf?: NonNullable<CompositionParts['programPoolOf']>;
  /** The server's clock; one a test steps says when its host is wholly at rest (see `heardFrom`). */
  readonly clock?: SteppedServerClock;
  readonly toolTiming?: NonNullable<CompositionParts['toolTiming']>;
  /** How the documents of answers are read: in the processes of a pool unless given, as `documentsReadInProcess`. */
  readonly documents?: NonNullable<CompositionParts['documents']>;
  readonly ledgerOver?: LedgerOver;
  readonly admit?: LanguageModel['Service']['admit'];
  readonly ledger?: TemporaryLedger;
  readonly signers?: NonNullable<CompositionParts['signers']>;
  readonly meter?: Meter;
  readonly installed?: NonNullable<CompositionParts['installed']>;
  readonly features?: Layer.Layer<LicensedFeatures>;
  readonly shippedFilesOver?: ShippedFilesOver;
  readonly goals?: boolean;
  readonly goalsResults?: boolean;
  readonly goalsMessages?: boolean;
  readonly startingWork?: NonNullable<CompositionParts['startingWork']>;
  readonly consumersOf?: NonNullable<CompositionParts['consumersOf']>;
  readonly goalsPortsOver?: NonNullable<CompositionParts['goalsPortsOver']>;
  readonly keptOutside?: boolean;
  readonly key?: string | ((origin: string) => Promise<string>);
  /**
   * `'http'` starts the server as `startServer` does, on a port with a ledger file, for a test whose subject is the
   * listener, a process or a file. Otherwise it answers in the process through its handler, on an in-memory ledger
   * unless `ledger` names a file.
   */
  readonly over?: 'http';
  /**
   * The server prepares its guide pages, access policies and providers itself and migrates its own ledger, as a real
   * start does, in place of taking them from `preparedParts`: for a test whose subject is that preparation.
   */
  readonly preparingItself?: true;
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

/** The server composed as given, Effect's Clock in its services reading the time of the clock its host runs on. */
export function composedOnTheClock(options: ComposedServerOptions, now: () => number): ComposedServerOptions {
  return {
    ...options,
    composed: async (settings, telemetry, shippedFiles) => {
      const composed = await options.composed(settings, telemetry, shippedFiles);
      const services = Layer.flatMap(composed.services, (served) =>
        Layer.succeedContext(Context.add(served, Clock.Clock, effectClockOn(now))),
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
  readonly ledgerOver: LedgerOver;
  readonly meter: Meter | undefined;
  readonly shippedFilesOver: ShippedFilesOver | undefined;
}

export function offloadingSetBy(keptOutside: boolean | undefined): Readonly<Record<string, string>> {
  return keptOutside === undefined ? {} : { PAYLOAD_OFFLOADING: String(keptOutside) };
}

/**
 * The server composed as given, whose calls wait on the policy decision point longer than any test lasts: a test
 * machine under load may take more than the second a server gives it, and that wait is no rule of the test. The
 * second itself is proven in operations, on a test clock.
 */
function composedPatiently(options: ComposedServerOptions): ComposedServerOptions {
  return {
    ...options,
    composed: async (settings, telemetry, shippedFiles) => {
      const composed = await options.composed(settings, telemetry, shippedFiles);
      const services = Layer.flatMap(composed.services, (served) =>
        Layer.succeedContext(Context.add(served, DecisionPointPatience, longerThanTheTestMs)),
      );
      return { ...composed, services };
    },
  };
}

function shippedOver(
  { shippedSettings: _readFromTheFilesItShipped, ...options }: ComposedServerOptions,
  shippedFilesOver: ShippedFilesOver,
): ComposedServerOptions {
  return { ...options, shippedFiles: shippedFilesOver(options.shippedFiles) };
}

export function composedWithTheParts(
  given: ComposedServerOptions,
  { ledgerOver, meter, shippedFilesOver }: ComposedParts,
): ComposedServerOptions {
  const options = composedPatiently(given);
  const shipped = shippedFilesOver === undefined ? options : shippedOver(options, shippedFilesOver);
  const metered = meter === undefined ? shipped : composedWithTheMeter(shipped, meter);
  return composedWithTheLedgerOver(metered, ledgerOver);
}

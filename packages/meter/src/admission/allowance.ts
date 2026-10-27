import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, randomUUIDv7, type Unavailable } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { Counting } from '../counting/run-starts.ts';
import type { Admitting } from '../meter-stream/meter-commands.ts';
import { executed, meterUnavailable, nowIso, runStreamOf, type MeterOptions, type Metering } from './metering.ts';

export type Limit = Pick<Admitting, 'allowance' | 'kind' | 'refusal'>;

function licenseRefusal({ allowance, studio }: MeterOptions): (installation: string) => string {
  return (installation) =>
    `This runtime has run the ${allowance} actions it may before it is registered. Register it at ${studio}/licenses?installation=${installation}, where an org gets its key for free, and activate it with that key`;
}

function admitting(run: MeteredRun, counting: Counting, at: string, holdMs: number): Omit<Admitting, keyof Limit> {
  return {
    type: 'admit',
    run: runStreamOf(run),
    counting,
    at,
    until: DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(at), { milliseconds: holdMs })),
    installation: randomUUIDv7(),
  };
}

export function admittedWithin(
  metering: Metering,
  run: MeteredRun,
  counting: Counting,
  limit: Limit,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const command = { ...admitting(run, counting, yield* nowIso, metering.options.holdMs), ...limit };
    return yield* executed(metering, command).pipe(
      Effect.catchIf(
        (refusal: unknown) => !(refusal instanceof Conflict && refusal.kind === limit.kind),
        () => Effect.fail(meterUnavailable),
      ),
      Effect.asVoid,
    );
  });
}

export function admittedByTheAllowance(
  metering: Metering,
  run: MeteredRun,
  counting: Counting,
): Effect.Effect<void, Conflict | Unavailable> {
  const { options } = metering;
  return admittedWithin(metering, run, counting, {
    allowance: options.allowance,
    kind: 'license_required',
    refusal: licenseRefusal(options),
  });
}

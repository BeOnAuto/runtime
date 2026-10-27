import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, randomUUIDv7, type Unavailable } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { Counting } from '../counting/run-starts.ts';
import type { MeterCommand } from '../meter-stream/meter-commands.ts';
import { executed, meterUnavailable, nowIso, runStreamOf, type MeterOptions, type Metering } from './metering.ts';

function licenseRefusal({ allowance, studio }: MeterOptions): (installation: string) => string {
  return (installation) =>
    `This runtime has run the ${allowance} actions it may before it is registered. Register it at ${studio}/licenses?installation=${installation}, where an org gets its key for free, and activate it with that key`;
}

function isNotALicenseRefusal(refusal: unknown): boolean {
  return !(refusal instanceof Conflict && refusal.kind === 'license_required');
}

function admitting(run: MeteredRun, counting: Counting, at: string, options: MeterOptions): MeterCommand {
  return {
    type: 'admit',
    run: runStreamOf(run),
    counting,
    allowance: options.allowance,
    at,
    until: DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(at), { milliseconds: options.holdMs })),
    installation: randomUUIDv7(),
    refusal: licenseRefusal(options),
  };
}

export function admittedByTheAllowance(
  metering: Metering,
  run: MeteredRun,
  counting: Counting,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const command = admitting(run, counting, yield* nowIso, metering.options);
    return yield* executed(metering, command).pipe(
      Effect.catchIf(isNotALicenseRefusal, () => Effect.fail(meterUnavailable)),
      Effect.asVoid,
    );
  });
}

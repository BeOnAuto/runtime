import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, randomUUIDv7, type Unavailable } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { Counting } from '../counting/run-starts.ts';
import type { Admitting } from '../meter-stream/meter-commands.ts';
import {
  executed,
  licensesPageOf,
  meterUnavailable,
  nowIso,
  runStreamOf,
  type MeterOptions,
  type Metering,
} from './metering.ts';

export type Limit = Pick<Admitting, 'allowance' | 'kind' | 'refusal'>;

function licenseRequired(options: MeterOptions): (installation: string) => Conflict {
  return (installation) => {
    const page = licensesPageOf(options, installation);
    return new Conflict({
      detail: `This runtime has used its ${options.allowance} free runs. Get a free key at ${page}, then activate it on the runtime and run this again.`,
      kind: 'license_required',
      resolve_at: page,
      runtime_id: installation,
    });
  };
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
    refusal: licenseRequired(options),
  });
}

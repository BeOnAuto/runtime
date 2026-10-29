import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, type Unavailable } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { Admitting } from '../meter-stream/meter-commands.ts';
import { executed, meterUnavailable, nowIso, runStreamOf, type Metering } from './metering.ts';

const meterRefusals: ReadonlySet<string> = new Set(['license_required', 'license_invalid', 'credits_exhausted']);

function isMeterRefusal(refusal: unknown): boolean {
  return refusal instanceof Conflict && meterRefusals.has(String(refusal.kind));
}

export function admittedWithin(
  metering: Metering,
  run: MeteredRun,
  { rule, installation }: Pick<Admitting, 'rule' | 'installation'>,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const at = yield* nowIso;
    const until = DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(at), { milliseconds: metering.options.holdMs }));
    const command: Admitting = { type: 'admit', run: runStreamOf(run), at, until, installation, rule };
    return yield* executed(metering, command).pipe(
      Effect.catchIf(
        (refusal: unknown) => !isMeterRefusal(refusal),
        () => Effect.fail(meterUnavailable),
      ),
      Effect.asVoid,
    );
  });
}
